module.exports = sync

var bsync = require('blob-store-replication-stream')
var handshake = require('handshake-stream')
var multiplex = require('multiplex')
var pump = require('pump')
var progressSync = require('./db-sync-progress')

function sync (db, media, opts) {
  var m = multiplex()
  var progress = {
    db: { sofar: 0, total: 0 },
    media: { sofar: 0, total: 0 }
  }

  var r = progressSync({osm:db}, {live: false, timeout: 0})
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
    m.emit('error', err)
  })

  var m1

  var remoteDeviceType
  function mediaSyncFilter (filename) {
    if (filename.startsWith('original/') && remoteDeviceType === 'mobile') return false
    else return true
  }

  // handshake protocol
  var accepted = false
  var shake = function (req, accept) {
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
        var m1s = m.createSharedStream('media')
        pump(m1, m1s, m1, function (err) {
          if (err) m.emit('error', err)
        })
        m1.once('finish', end)
      }
      accept(err)
    }
  }
  var payload = {
    protocolVersion: 1,
    deviceType: opts.deviceType,
    deviceName: opts.deviceName
  }

  // wrap in handshake
  var hand = handshake(m, payload, shake)

  var pending = 2
  r.once('end', end)
  function end () {
    if (--pending) return
    hand.goodFinish = true
    m.end()
  }

  return hand
}
