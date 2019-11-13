module.exports = sync

var bsync = require('blob-store-replication-stream')
var handshake = require('handshake-stream')
var multiplex = require('multiplex')
var pump = require('pump')
var progressSync = require('./db-sync-progress')

function sync (isInitiator, db, media, opts) {
  var payload = {
    id: opts.id,
    protocolVersion: 1,
    deviceType: opts.deviceType,
    deviceName: opts.deviceName
  }
  // handshake protocol
  var accepted = false

  var m = multiplex()
  // wrap in handshake
  var hand = handshake(m, payload, function (req, accept) {
    if (req.protocolVersion === 1) {
      remoteDeviceType = req.deviceType

      if (opts.handshake) opts.handshake(req, onaccept); else onaccept()
    } else {
      onaccept(new Error('unexpected remote protocol version: ' + req.protocolVersion))
    }

    function onaccept (err) {
      if (accepted) return
      accepted = true
      if (!err) {
        m1 = bsync(media, { filter: mediaSyncFilter })
        m1.on('progress', function (sofar, total) {
          progress.media.sofar = sofar
          progress.media.total = total
          hand.emit('progress', progress)
        })
        console.log('shared stream')
        var m1s = m.createSharedStream('media')
        pump(m1, m1s, m1, function (err) {
          if (err) hand.emit('error', err)
        })
        m1.once('finish', end)
      }
      hand.emit('sync-start')
      accept(err)
    }
  })

  var m1
  var progress = {
    db: { sofar: 0, total: 0 },
    media: { sofar: 0, total: 0 }
  }

  var r = progressSync(isInitiator, {osm:db}, {live: false, timeout: 0})
  r.on('progress', function (sofar, total) {
    progress.db.sofar = sofar
    progress.db.total = total
    hand.emit('progress', progress)
  })

  var p2p = m.createSharedStream('p2p')
  // XXX: Using pipe() here instead of pump because of a bug in multifeed
  // (probably) where both sides of the stream aren't being closed properly
  // on end-of-stream.
  r.pipe(p2p).pipe(r)
  r.once('error', function (err) {
    hand.emit('error', err)
  })

  var remoteDeviceType
  function mediaSyncFilter (filename) {
    if (filename.startsWith('original/') && remoteDeviceType === 'mobile') return false
    else return true
  }

  var pending = 2
  r.once('end', end)
  function end () {
    if (--pending) return
    hand.goodFinish = true
    m.end()
  }

  return hand
}
