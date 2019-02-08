module.exports = sync

var bsync = require('blob-store-replication-stream')
var handshake = require('handshake-stream')
var multiplex = require('multiplex')
var pump = require('pump')

function sync (db, media, opts) {
  var m = multiplex()

  // p2p
  var r = db.log ? db.log.replicate() : db.replicate()
  var p2p = m.createSharedStream('p2p')
  // XXX: Using pipe() here instead of pump because of a bug in multifeed
  // (probably) where both sides of the stream aren't being closed properly
  // on end-of-stream.
  r.pipe(p2p).pipe(r)
  r.once('error', function (err) {
    m.emit('error', err)
  })

  // media
  var m1 = bsync(media)
  var m1s = m.createSharedStream('media')
  pump(m1, m1s, m1, function (err) {
    if (err) m.emit('error', err)
  })

  // TODO: handle all 3 media stores as separate streams (full, preview, thumbnail)
  // + add them dynamically to the multiplex stream depending on the remote handshake payload below

  // handshake protocol
  var shake = function (req, accept) {
    if (req.protocolVersion === 1) {
      accept()
    } else {
      accept(new Error('unexpected remote protocol version: ' + req.protocolVersion))
    }
  }
  var payload = { protocolVersion: 1, deviceType: opts.deviceType }

  // wrap in handshake
  var hand = handshake(m, payload, shake)

  // TODO: what happens if an inner stream emits an error? does multiplex catch + propagate it?

  var pending = 2
  r.once('end', end)
  m1.once('finish', end)
  function end () {
    console.error('end 1')
    if (--pending) return
    console.error('end 2')
    m.end()
  }

  return hand
}
