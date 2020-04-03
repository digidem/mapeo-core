module.exports = sync

const bsync = require('blob-store-replication-stream')
const handshake = require('handshake-stream')
const multiplex = require('multiplex')
const pump = require('pump')
const once = require('once')
const progressSync = require('./db-sync-progress')
const util = require('./util')
const MRPC = require('muxrpc')
const pull = require('pull-stream')
const toPull = require('stream-to-pull-stream')

function sync (db, media, opts) {
  let expectedDownloads, expectedUploads
  let remoteDeviceType

  const localDbState = util.dbState(db)
  const multistream = multiplex()
  const progress = {
    db: { sofar: 0, total: 0 },
    media: { sofar: 0, total: 0 }
  }

  function createMultifeedSyncStream (name) {
    const r = progressSync(opts.isInitiator, {osm: db}, {live: false, timeout: 0})
    r.setTotals(expectedDownloads, expectedUploads)
    r.on('progress', function (sofar, total) {
      progress.db.sofar = sofar
      progress.db.total = total
      hand.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
    })
    const p2p = multistream.createSharedStream('multifeed-' + name)
    pump(r, p2p, r, function (err) {
      if (err) hand.emit('error', err)
      else end()
    })
    return p2p
  }

  function createBlobSyncStream (name) {
    const blobsync = bsync(media, { filter: mediaSyncFilter.bind(null, remoteDeviceType) })
    blobsync.on('progress', function (sofar, total) {
      progress.media.sofar = sofar
      progress.media.total = total
      hand.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
    })
    const p2p = multistream.createSharedStream('media-' + name)
    pump(blobsync, p2p, blobsync, function (err) {
      if (err) hand.emit('error', err)
    })
    blobsync.once('finish', end)
    return p2p
  }

  // wrap in handshake
  const handshakePayload = {
    id: opts.id,
    protocolVersion: opts.protocolVersion || 1,
    deviceType: opts.deviceType,
    deviceName: opts.deviceName,
    state: {
      db: localDbState
    }
  }
  const hand = handshake(multistream, handshakePayload, function (req, accept) {
    if (req.protocolVersion === opts.protocolVersion) {
      remoteDeviceType = req.deviceType

      // TODO: this needs to be rethought, because reusable streams
      expectedDownloads = util.getExpectedDownloadEvents(localDbState, req.state.db)
      expectedUploads = util.getExpectedUploadEvents(localDbState, req.state.db)

      if (opts.handshake) opts.handshake(req, once(onaccept)); else onaccept()
    } else {
      process.nextTick(function () {
        onaccept(new Error('Incompatible remote protocol version: ' + req.protocolVersion))
      })
    }

    function onaccept (err) {
      if (!err) {
        console.log('requesting mf sync')
        rpc.createMultifeedSyncStream('0', (err, accept) => {
          if (err) return hand.emit('error', err)
          console.log('mf sync response', accept)
        })

        console.log('requesting blob sync')
        rpc.createBlobSyncStream('0', (err, accept) => {
          if (err) return hand.emit('error', err)
          console.log('blob sync response', accept)
        })
      }
      hand.emit('sync-start')
      accept(err)
    }
  })

  // RPC stream.
  const rpcManifest = {
    createMultifeedSyncStream: 'async',
    createBlobSyncStream: 'async'
  }
  const rpcApi = {
    createMultifeedSyncStream (name, cb) {
      createMultifeedSyncStream(name)
      cb(null, true)
    },
    createBlobSyncStream (name, cb) {
      createBlobSyncStream(name)
      cb(null, true)
    }
  }
  const rpc = MRPC(rpcManifest, rpcManifest)(rpcApi)
  const multiRpc = multistream.createSharedStream('rpc')
  const multiRpcPull = toPull.duplex(multiRpc)
  pull(multiRpcPull, rpc.createStream(), multiRpcPull)

  let pending = 2
  function end () {
    if (--pending) return
    hand.goodFinish = true
    multistream.end()
  }

  return hand
}

function mediaSyncFilter (remoteDeviceType, filename) {
  if (filename.startsWith('original/') && remoteDeviceType === 'mobile') return false
  else return true
}
