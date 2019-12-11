module.exports = sync

var bsync = require('blob-store-replication-stream')
var handshake = require('./handshake-stream')
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

  var m = multiplex()

  var m1
  var progress = {
    db: { sofar: 0, total: 0 },
    media: { sofar: 0, total: 0 }
  }

  var r = progressSync(isInitiator, {osm:db}, {live: false, timeout: 0})
  r.on('progress', function (sofar, total) {
    progress.db.sofar = sofar
    progress.db.total = total
    m.emit('progress', progress)
  })

  var p2p = m.createSharedStream('p2p')
  pump(r, p2p, r, function (err) {
    if (err) m.emit('error', err)
    else end()
  })

  var id = String(Math.random()).slice(2, 6)
  console.log(id, '1')
  // wrap in handshake
  handshake(r, payload, {
    // XXX: somehow THIS is being called twice on one of the sides, despite different handshake instances getting the payload
    onpayload: function (req, accept) {
      console.log(id, '2')
      if (req.protocolVersion === opts.protocolVersion) {
        remoteDeviceType = req.deviceType
        if (opts.handshake) opts.handshake(req, accept); else accept(null, true)
      } else {
        process.nextTick(function () {
          accept(new Error('Incompatible remote protocol version: ' + req.protocolVersion))
        })
      }
    },
    onresponse: function (remoteAccept) {
      console.log('onresponse', remoteAccept)
      m.emit('handshake-response', remoteAccept)
    },
    onaccept: function (localAccept, remoteAccept) {
      if (!localAccept || !remoteAccept) {
        end()
        return
      }

      m1 = bsync(media, { filter: mediaSyncFilter })
      m1.on('progress', function (sofar, total) {
        progress.media.sofar = sofar
        progress.media.total = total
        m.emit('progress', progress)
      })
      var m1s = m.createSharedStream('media')
      pump(m1, m1s, m1, function (err) {
        if (err) m.emit('error', err)
      })
      m1.once('finish', end)

      m.emit('sync-start')
    }
  })

  var remoteDeviceType
  function mediaSyncFilter (filename) {
    if (filename.startsWith('original/') && remoteDeviceType === 'mobile') return false
    else return true
  }

  var pending = 2
  function end () {
    if (--pending) return
    m.goodFinish = true
    m.end()
  }

  return m
}
