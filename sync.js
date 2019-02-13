const path = require('path')
const createMediaReplicationStream = require('blob-store-replication-stream')
const sneakernet = require('hyperlog-sneakernet-replicator')
const Syncfile = require('osm-p2p-syncfile')
const debug = require('debug')('mapeo-sync')
const Swarm = require('discovery-swarm')
const values = require('object.values')
const events = require('events')
const fs = require('fs')
const os = require('os')
const randombytes = require('randombytes')
const pump = require('pump')
const MapeoSync = require('./lib/sync-stream')

const SYNC_TYPE = 'mapeo-sync'
const SYNCFILE_FORMATS = {
  'hyperlog-sneakernet': 1,
  'osm-p2p-syncfile'   : 2
}
const DEFAULT_OPTS = {
  dns: {
    interval: 3000
  },
  dht: false
}

class Sync extends events.EventEmitter {
  constructor (osm, media, opts) {
    super()
    opts = Object.assign(DEFAULT_OPTS, opts)
    opts.writeFormat = opts.writeFormat || 'hyperlog-sneakernet'
    if (!SYNCFILE_FORMATS[opts.writeFormat]) throw new Error('unknown syncfile write format: ' + opts.writeFormat)

    this.osm = osm
    this.media = media
    if (!opts.id) opts.id = randombytes(32)
    this.opts = opts

    // track discovered wifi peers
    this._targets = {}

    this.swarm = this._swarm()
  }

  targets () {
    return values(this._targets)
  }

  start (target, opts) {
    var emitter = new events.EventEmitter()
    if (!target.handshake) {
      process.nextTick(function () {
        emitter.emit('error', new Error('trying to sync before handshake has occurred'))
      })
      return emitter
    }

    // return existing emitter
    if (target.sync) return target.sync

    target.handshake.accept()
    target.sync = emitter
    return emitter
  }

  listen (cb) {
    this.swarm.listen(0, cb)
    this.swarm.join(SYNC_TYPE)
  }

  close (cb) {
    if (!cb) cb = () => {}
    this.swarm.destroy(() => {
      this.swarm = null
      cb()
    })
  }

  /**
   * Replicate from a given file
   * @param  {String}   path    The target source filepath
   * @return {EventEmitter}     Listen to 'error', 'end' and 'progress' events
   */
  replicateFromFile (sourceFile) {
    var self = this
    const emitter = new events.EventEmitter()

    // FIXME: this wraps & re-wraps the function each time this func is called!
    const replicateOrig = this.osm.log.replicate
    this.osm.log.replicate = function () {
      const stream = replicateOrig.call(self.osm.log)
      stream.on('data', function () {
        emitter.emit('progress')
      })
      return stream
    }

    fs.access(sourceFile, function (err) {
      if (err) { // file doesn't exist, write
        if (self.opts.writeFormat === 'hyperlog-sneakernet') syncOld()
        else if (self.opts.writeFormat === 'osm-p2p-syncfile') syncNew()
      } else { // read
        isGzipFile(sourceFile, function (err, isGzip) {
          if (err) return onerror(err)
          if (isGzip) syncOld()
          else syncNew()
        })
      }
    })

    function syncOld () {
      sneakernet(self.osm.log, { safetyFile: true }, sourceFile, onend)
    }

    function syncNew () {
      const syncfile = new Syncfile(sourceFile, os.tmpdir())
      syncfile.ready(function (err) {
        if (err) return onerror(err)
        const r1 = syncfile.osm.log.replicate({live: false})
        const r2 = self.osm.log.replicate({live: false})
        const m1 = createMediaReplicationStream(syncfile.media)
        const m2 = createMediaReplicationStream(self.media)
        var error
        var pending = 2
        pump(r1, r2, r1, fin)
        pump(m1, m2, m1, fin)
        function fin (err) {
          if (err) error = err
          if (!--pending) {
            syncfile.userdata({'p2p-db': 'hyperlog'}, function () {
              syncfile.close(onend.bind(null, error))
            })
          }
        }
      })
    }

    function onerror (err) {
      emitter.emit('error', err)
    }

    function onend (err) {
      if (err) return onerror(err)
      self.osm.ready(function () {
        emitter.emit('end')
      })
    }

    return emitter
  }

  _swarm () {
    var self = this
    // XXX(noffle): having opts.id set causes connections to get dropped on my
    // local home network; haven't investigated deeper yet.
    var swarm = Swarm(Object.assign({}, this.opts, {id: undefined}))

    swarm.on('connection', (connection, info) => {
      const target = WifiTarget(connection, info)
      this._targets[target.id] = target
      debug('connection', target)

      connection.once('close', onClose)
      connection.once('error', onClose)

      var open = true

      function onClose (err) {
        open = false
        const target = WifiTarget(connection, info)
        this.emit('down', target)
        debug('down', target)
        delete self._targets[target.id]
      }

      var stream
      setTimeout(doSync, 500)

      function doSync () {
        if (!open) return
        // Set up the sync stream immediately, but don't do anything with it
        // until one side initiates the sync operation.
        stream = MapeoSync(self.osm, self.media, {
          deviceType: self.opts.deviceType || 'unknown',
          handshake: onHandshake
        })
        pump(stream, connection, stream, function (err) {
          if (target.sync) {
            if (err) target.sync.emit('error', err)
            else target.sync.emit('end')
          }
          // delete target.handshake
          // delete target.sync
        })
      }

      function onHandshake (req, accept) {
        target.handshake = {
          accept: accept
        }

        // as soon as any data is received, accept! Because this means that
        // the other side just have accepted & wants to start.
        stream.once('accepted', function () {
          accept()
        })

        self.emit('target', target)
      }
    })
    return swarm
  }
}

function isGzipFile (filepath, cb) {
  fs.exists(filepath, function (exists) {
    if (!exists) return cb(null, false)
    fs.open(filepath, 'r', function (err, fd) {
      if (err) return cb(err)
      var magic = Buffer.alloc(2)
      fs.read(fd, magic, 0, 2, 0, function (err) {
        if (err) return cb(err)
        const isGzip = (magic.toString('hex') === '1f8b')
        fs.close(fd, function (err) {
          if (err) return cb(err)
          cb(null, isGzip)
        })
      })
    })
  })
}

function WifiTarget (connection, peer) {
  peer.type = 'wifi'
  peer.swarmId = peer.swarmId || peer.id
  // XXX: this is so that each connection has a unique id, even if it's from the same peer.
  peer.id = (!peer.id || peer.id.length!==12) ? randombytes(6).toString('hex') : peer.id
  return peer
}

function FileTarget (filename) {
  return {
    id: path.basename(filename),
    filename,
    type: 'file'
  }
}

module.exports = Sync
