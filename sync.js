const path = require('path')
const createMediaReplicationStream = require('blob-store-replication-stream')
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
const progressSync = require('./lib/db-sync-progress')

const SYNC_TYPE = 'mapeo-sync'
const SYNCFILE_FORMATS = {
  'hyperlog-sneakernet': 1,
  'osm-p2p-syncfile'   : 2
}

const DEFAULT_OPTS = {
  dns: {
    interval: 3000
  },
  dht: false,
  utp: false
}

class Sync extends events.EventEmitter {
  constructor (osm, media, opts) {
    super()
    opts = Object.assign(DEFAULT_OPTS, opts)
    opts.writeFormat = opts.writeFormat || 'osm-p2p-syncfile'
    if (!SYNCFILE_FORMATS[opts.writeFormat]) throw new Error('unknown syncfile write format: ' + opts.writeFormat)

    this.osm = osm
    this.media = media
    this.name = opts.name
    if (!opts.id) opts.id = randombytes(32)
    this.opts = Object.assign({}, opts)

    this._activeSyncs = 0

    // track discovered wifi peers
    this._peers = {}
  }

  peers () {
    return values(this._peers)
  }

  _getPeerFromHostPort (host, port) {
    var res = values(this._peers)
      .filter(function (peer) {
        // this needs not triple equals, for some reason it fails
        return peer.port == port && peer.host == host
      })
    if (res.length) {
      return res[0]
    } else {
      return null
    }
  }

  start ({host, port}, opts) {
    var emitter = new events.EventEmitter()
    var peer = this._getPeerFromHostPort(host, port)
    if (!peer) {
      process.nextTick(function () {
        emitter.emit('error', new Error('trying to sync to unknown peer'))
      })
      return emitter
    }
    if (!peer.handshake) {
      process.nextTick(function () {
        emitter.emit('error', new Error('trying to sync before handshake has occurred'))
      })
      return emitter
    }

    // return existing emitter
    if (peer.sync) return peer.sync

    peer.handshake.accept()
    peer.sync = emitter

    return emitter
  }

  listen (cb) {
    if (!cb) cb = () => {}
    if (this.swarm || this._destroyingSwarm) {
      console.error('Swarm already exists or is currently destroying itself..')
      return process.nextTick(cb)
    }
    this.swarm = this._swarm()
    this.swarm.listen(0, cb)
  }

  leave (_type) {
    this.swarm.leave(_type || SYNC_TYPE)
  }

  join (_type) {
    this.swarm.join(_type || SYNC_TYPE)
  }

  destroy (cb) {
    this.close(cb)
  }

  close (cb) {
    if (!cb) cb = () => {}
    if (!this.swarm || this._destroyingSwarm) return process.nextTick(cb)
    this._destroyingSwarm = true
    this.swarm.destroy(() => {
      this.swarm = null
      this._destroyingSwarm = false
      cb()
    })
  }

  /**
   * Replicate from a given file
   * @param  {String}   path    The source filepath
   * @return {EventEmitter}     Listen to 'error', 'end' and 'progress' events
   */
  replicateFromFile (sourceFile) {
    var self = this
    const emitter = new events.EventEmitter()

    fs.access(sourceFile, function (err) {
      if (err) { // file doesn't exist, write
        if (self.opts.writeFormat === 'osm-p2p-syncfile') sync()
        else return onerror(new Error('unsupported syncfile type'))
      } else { // read
        isGzipFile(sourceFile, function (err, isGzip) {
          if (err) return onerror(err)
          if (!isGzip) sync()
          else return onerror(new Error('unsupported syncfile type'))
        })
      }
    })

    function sync () {
      const syncfile = new Syncfile(sourceFile, os.tmpdir())
      syncfile.ready(function (err) {
        if (err) return onerror(err)
        const r1 = syncfile.replicateData({live: false})
        const r2 = progressSync(self, {live: false})
        const m1 = syncfile.replicateMedia()
        const m2 = createMediaReplicationStream(self.media)
        var error
        var pending = 2
        pump(r1, r2, r1, fin)
        pump(m1, m2, m1, fin)
        function fin (err) {
          // HACK(noffle): workaround for sync bug
          if (err && err.message === 'premature close') err = undefined

          if (err) error = err
          if (!--pending) {
            syncfile.userdata({'p2p-db': 'kappa-osm'}, function () {
              syncfile.close(onend.bind(null, error))
            })
          }
        }

        // track sync progress
        var progress = {
          db: { sofar: 0, total: 0 },
          media: { sofar: 0, total: 0 }
        }
        r2.on('progress', function (sofar, total) {
          progress.db.sofar = sofar
          progress.db.total = total
          emitter.emit('progress', progress)
        })
        m2.on('progress', function (sofar, total) {
          progress.media.sofar = sofar
          progress.media.total = total
          emitter.emit('progress', progress)
        })
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

  setName (name) {
    this.name = name
  }

  _swarm () {
    var self = this
    // XXX(noffle): having opts.id set causes connections to get dropped on my
    // local home network; haven't investigated deeper yet.
    var swarm = Swarm(Object.assign({}, this.opts, {id: undefined}))

    swarm.on('connection', (connection, info) => {
      const peer = WifiPeer(connection, info)
      debug('connection', peer)

      connection.once('close', onClose)
      connection.once('error', onClose)

      var open = true
      var stream
      setTimeout(doSync, 500)

      function onClose () {
        open = false
        const peer = WifiPeer(connection, info)
        self.emit('down', peer)
        debug('down', peer)
        delete self._peers[peer.id]
      }

      function doSync () {
        if (!open) return
        // Set up the sync stream immediately, but don't do anything with it
        // until one side initiates the sync operation.
        stream = MapeoSync(self.osm, self.media, {
          deviceType: self.opts.deviceType || 'unknown',
          deviceName: self.name || os.hostname() || 'unnamed device',
          handshake: onHandshake
        })
        stream.once('sync-start', function () {
          if (++self._activeSyncs === 1) {
            self.osm.core.pause()
          }
        })
        stream.on('progress', function (progress) {
          if (peer.sync) {
            peer.status = 'replication-progress'
            peer.progress = progress
            peer.sync.emit('progress', peer.progress)
          }
        })
        pump(stream, connection, stream, function (err) {
          if (--self._activeSyncs === 0) {
            self.osm.core.resume()
          }
          if (peer.sync) {
            if (stream.goodFinish) {
              peer.status = 'replication-complete'
              peer.message = undefined
              peer.sync.emit('end')
            } else {
              if (!err) err = new Error('sync stream terminated on remote side')
              peer.status = 'replication-error'
              peer.error = err
              peer.sync.emit('error', err)
            }
          }
          onClose()
        })
      }

      function onHandshake (req, accept) {
        peer.handshake = {
          accept: accept
        }
        peer.name = req.deviceName

        // as soon as any data is received, accept! Because this means that
        // the other side just have accepted & wants to start.
        stream.once('accepted', function () {
          // TODO: show peer status here
          accept()
        })

        self._peers[peer.id] = peer
        self.emit('peer', peer)
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

function WifiPeer (connection, info) {
  info.type = 'wifi'
  info.swarmId = info.swarmId || info.id
  // XXX: this is so that each connection has a unique id, even if it's from the same peer.
  info.id = (!info.id || info.id.length !== 12) ? randombytes(6).toString('hex') : info.id
  info.connection = connection
  return info
}

module.exports = Sync
