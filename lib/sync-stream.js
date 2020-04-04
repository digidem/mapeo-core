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
  let pendingStreamEnds = 2
  let remoteDeviceType
  const multistream = multiplex()
  const progress = {
    db: { sofar: 0, total: 0 },
    media: { sofar: 0, total: 0 }
  }

  // sync stream gets wrapped in a handshake-stream
  const handshakePayload = {
    id: opts.id,
    protocolVersion: opts.protocolVersion || 1,
    deviceType: opts.deviceType,
    deviceName: opts.deviceName
  }
  const hand = handshake(multistream, handshakePayload, function (req, accept) {
    if (req.protocolVersion === opts.protocolVersion) {
      remoteDeviceType = req.deviceType

      if (opts.handshake) opts.handshake(req, once(onaccept)); else onaccept()
    } else {
      process.nextTick(function () {
        onaccept(new Error('Incompatible remote protocol version: ' + req.protocolVersion))
      })
    }

    function onaccept (err) {
      accept(err)
      hand.emit('sync-start')
      if (!err && opts.isInitiator) hand.emit('sync-start-initiator')
    }
  })

  function onStreamEnd () {
    if (--pendingStreamEnds) return
    hand.goodFinish = true
    multistream.end()
  }

  function onStreamError (err) {
    hand.emit('error', err)
  }

  function onStreamProgress (dbSofar, dbTotal, mediaSofar, mediaTotal) {
    if (dbSofar || dbTotal) {
      progress.db.sofar = dbSofar
      progress.db.total = dbTotal
    }
    if (mediaSofar || mediaTotal) {
      progress.media.sofar = mediaSofar
      progress.media.total = mediaTotal
    }
    hand.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
  }

  function createMultifeedSyncStream (name) {
    const r = progressSync(opts.isInitiator, {osm: db}, {live: false})
    r.on('progress', function (sofar, total) {
      onStreamProgress(sofar, total)
    })
    const p2p = multistream.createSharedStream('multifeed-' + name)
    pump(r, p2p, r, function (err) {
      if (err) onStreamError(err)
      else onStreamEnd()
    })
    return r
  }

  function createBlobSyncStream (name) {
    const blobsync = bsync(media, { filter: mediaSyncFilter.bind(null, remoteDeviceType) })
    blobsync.on('progress', function (sofar, total) {
      onStreamProgress(null, null, sofar, total)
    })
    const p2p = multistream.createSharedStream('media-' + name)
    pump(blobsync, p2p, blobsync, function (err) {
      if (err) onStreamEnd(err)
    })
    blobsync.once('finish', onStreamEnd)
  }

  // RPC instance & stream
  const rpcManifest = {
    createMultifeedSyncStream: 'async',
    createBlobSyncStream: 'async',
    getMultifeedTotals: 'async'
  }
  const rpcApi = {
    createMultifeedSyncStream (name, remoteDbState, cb) {
      const localDbState = util.dbState(db)
      const sync = createMultifeedSyncStream(name)

      rpc.getMultifeedTotals((err, remoteDbState) => {
        if (err) return onStreamError(err)
        const expectedDownloads = util.getExpectedDownloadEvents(localDbState, remoteDbState)
        const expectedUploads = util.getExpectedUploadEvents(localDbState, remoteDbState)
        sync.setTotals(expectedDownloads, expectedUploads)
      })

      cb(null, { accept: true, state: localDbState })
    },
    getMultifeedTotals (cb) {
      cb(null, util.dbState(db))
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

  function doSync () {
    const localDbState = util.dbState(db)
    rpc.createMultifeedSyncStream('0', localDbState, (err, res) => {
      if (err) return onStreamError(err)

      const sync = createMultifeedSyncStream('0')
      rpc.getMultifeedTotals((err, remoteDbState) => {
        if (err) return onStreamError(err)
        const expectedDownloads = util.getExpectedDownloadEvents(localDbState, remoteDbState)
        const expectedUploads = util.getExpectedUploadEvents(localDbState, remoteDbState)
        sync.setTotals(expectedDownloads, expectedUploads)
      })
    })

    rpc.createBlobSyncStream('0', (err, accept) => {
      if (err) return onStreamError(err)
      createBlobSyncStream('0')
    })
  }
  hand.once('sync-start-initiator', doSync)

  return hand
}

function mediaSyncFilter (remoteDeviceType, filename) {
  if (filename.startsWith('original/') && remoteDeviceType === 'mobile') return false
  else return true
}
