module.exports = sync

var bsync = require('blob-store-replication-stream')
var handshake = require('handshake-stream')
var multiplex = require('multiplex')
var pump = require('pump')
var progressSync = require('./db-sync-progress')

function sync (isInitiator, db, media, opts) {
  var payload = {
    id: opts.id,
    protocolVersion: opts.protocolVersion || 1,
    deviceType: opts.deviceType,
    deviceName: opts.deviceName,
  }
  // handshake protocol
  var accepted = false

  var m = multiplex()
  // wrap in handshake
  var hand = handshake(m, payload, function (req, accept) {
    if (req.protocolVersion === opts.protocolVersion) {
      remoteDeviceType = req.deviceType
      if (opts.handshake) opts.handshake(req, onaccept); else onaccept()
    } else {
      process.nextTick(function () {
        onaccept(new Error('Incompatible remote protocol version: ' + req.protocolVersion))
      })
    }

    function onaccept (err) {
      if (accepted) return
      accepted = true
      if (!err) {
        m1 = bsync(media, { filter: mediaSyncFilter })
        m1.on('progress', function (sofar, total) {
          progress.media.sofar = sofar
          progress.media.total = total
          hand.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
        })
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
    hand.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
  })

  var p2p = m.createSharedStream('p2p')
  pump(r, p2p, r, function (err) {
    if (err) hand.emit('error', err)
    else end()
  })

  var remoteDeviceType
  function mediaSyncFilter (filename) {
    if (filename.startsWith('original/') && remoteDeviceType === 'mobile') return false
    else return true
  }

  var pending = 2
  function end () {
    if (--pending) return
    hand.goodFinish = true
    m.end()
  }

  return hand
}
