module.exports = sync

var bsync = require('blob-store-replication-stream')
var handshake = require('handshake-stream')
var multiplex = require('multiplex')
var pump = require('pump')
var once = require('once')
var progressSync = require('./db-sync-progress')
var util = require('./util')
var MRPC = require('muxrpc')
var pull = require('pull-stream')
var toPull = require('stream-to-pull-stream')

// RPC manifest & API.
const rpcManifest = {
  hello: 'async'
}
const rpcApi = {
  hello(name, cb) {
    cb(null, 'hello, ' + name + '!')
  }
}

function sync (isInitiator, db, media, opts) {
  const localDbState = util.dbState(db)
  const payload = {
    id: opts.id,
    protocolVersion: opts.protocolVersion || 1,
    deviceType: opts.deviceType,
    deviceName: opts.deviceName,
    state: {
      db: localDbState
    }
  }
  let expectedDownloads, expectedUploads
  let remoteDeviceType

  const progress = {
    db: { sofar: 0, total: 0 },
    media: { sofar: 0, total: 0 }
  }
  const multistream = multiplex()
  let blobsync

  // wrap in handshake
  const hand = handshake(multistream, payload, function (req, accept) {
    if (req.protocolVersion === opts.protocolVersion) {
      remoteDeviceType = req.deviceType

      expectedDownloads = util.getExpectedDownloadEvents(localDbState, req.state.db)
      expectedUploads = util.getExpectedUploadEvents(localDbState, req.state.db)
      r.setTotals(expectedDownloads, expectedUploads)

      if (opts.handshake) opts.handshake(req, once(onaccept)); else onaccept()
    } else {
      process.nextTick(function () {
        onaccept(new Error('Incompatible remote protocol version: ' + req.protocolVersion))
      })
    }

    function onaccept (err) {
      if (!err) {
        blobsync = bsync(media, { filter: mediaSyncFilter.bind(null, remoteDeviceType) })
        blobsync.on('progress', function (sofar, total) {
          progress.media.sofar = sofar
          progress.media.total = total
          hand.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
        })
        var m1s = multistream.createSharedStream('media')
        pump(blobsync, m1s, blobsync, function (err) {
          if (err) hand.emit('error', err)
        })
        blobsync.once('finish', end)
      }
      hand.emit('sync-start')
      accept(err)
    }
  })

  const r = progressSync(isInitiator, {osm: db}, {live: false, timeout: 0})
  r.on('progress', function (sofar, total) {
    progress.db.sofar = sofar
    progress.db.total = total
    hand.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
  })

  // KappaDB / multifeed stream.
  const p2p = multistream.createSharedStream('p2p')
  pump(r, p2p, r, function (err) {
    if (err) hand.emit('error', err)
    else end()
  })

  // RPC stream.
  const rpc = MRPC(rpcManifest, rpcManifest)(rpcApi)
  const multiRpc = multistream.createSharedStream('rpc')
  const multiRpcPull = toPull.duplex(multiRpc)
  pull(multiRpcPull, rpc.createStream(), multiRpcPull)

  // rpc.hello('from the other side', function (err, answer) {
  //   console.log('RESPONSE', answer)
  // })

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
