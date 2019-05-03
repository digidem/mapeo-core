const path = require('path')
const createMediaReplicationStream = require('blob-store-replication-stream')
const Syncfile = require('osm-p2p-syncfile')
const debug = require('debug')('mapeo-sync')
const Swarm = require('discovery-swarm')
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

const states = {
  WIFI_READY: 'replication-wifi-ready',
  PROGRESS: 'replication-progress',
  COMPLETE: 'replication-complete',
  ERROR: 'replication-error',
  STARTED: 'replication-started'
}

function PeerState (topic, message) {
  return { topic, message }
}

class SyncState {
  constructor () {
    this._completed = {}
    this._state = {}
  }

  add (peer) {
    peer.sync = new events.EventEmitter()
    var onprogress = (progress) => this.onprogress(peer, progress)
    var onerror = (error) => this.onerror(peer, error)
    var onend = () => {
      this.onend(peer)
      peer.sync.removeListener('end', onend)
      peer.sync.removeListener('error', onerror)
      peer.sync.removeListener('progress', onprogress)
    }

    peer.sync.on('progress', onprogress)
    peer.sync.on('error', onerror)
    peer.sync.on('end', onend)

    this._state[peer.id] = peer
  }

  get (host, port) {
    var res = Object.values(this._state)
      .filter(function (peer) {
        return peer.port === port && peer.host === host
      })
    if (res.length) {
      return res[0]
    } else {
      return null
    }
  }

  clear () {
    this._state = {}
  }

  _isclosed (peer) {
    return peer.state.topic === states.COMPLETE
  }

  onwifi (peer) {
    peer.state = PeerState(states.WIFI_READY)
    this.add(peer)
  }

  onfile (peer) {
    peer.state = PeerState(states.STARTED)
    this.add(peer)
  }

  onprogress (peer, progress) {
    if (this._isclosed(peer)) return
    peer.state = PeerState(states.PROGRESS, progress)
  }

  onerror (peer, error) {
    peer.state = PeerState(states.ERROR, error.message)
  }

  onend (peer) {
    peer.state = PeerState(states.COMPLETE, Date.now())
    this._completed[peer.name] = Object.assign({}, peer)
    delete this._state[peer.id]
  }

  peers () {
    var self = this
    var peers = []
    Object.values(this._state).map((peer) => {
      var completed = self._completed[peer.name]
      if (completed) peer.state.lastCompletedDate = completed.state.message
      peers.push(peer)
    })
    Object.values(this._completed).map((peer) => {
      if (!(peers.find((p) => p.name === peer.name))) peers.push(peer)
    })
    return peers
  }
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
    // track all peer states
    this.state = new SyncState()
  }

  clearState () {
    this.state.clear()
  }

  peers () {
    return this.state.peers()
  }

  replicate ({host, port, filename}, opts) {
    if (!opts) opts = {}
    var peer

    if (host && port) {
      port = parseInt(port)
      peer = this.state.get(host, port)
      if (!peer) {
        var emitter = new events.EventEmitter()
        process.nextTick(() => {
          emitter.emit('error', new Error('trying to sync to unknown peer'))
        })
        return emitter
      }
      this.replicateNetwork(peer, opts)
    } else if (filename) {
      peer = {
        id: filename,
        name: filename,
        filename
      }
      this.state.onfile(peer)
      this.replicateFromFile(peer, opts)
    } else throw new Error('Requires filename or host and port')

    return peer.sync
  }

  replicateNetwork (peer, opts) {
    if (!peer.handshake) {
      process.nextTick(function () {
        peer.sync.emit('error', new Error('trying to sync before handshake has occurred'))
      })
      return peer.sync
    }

    // return existing emitter
    if (peer.accepted) return peer.sync

    peer.handshake.accept()
    peer.accepted = true
    return peer.sync
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
   * Replicate from a given file. Use `replicate` instead.
   * @param  {String}   peer    A peer.
   * @return {EventEmitter}     Listen to 'error', 'end' and 'progress' events
   */
  replicateFromFile (peer) {
    var self = this
    var emitter = peer.sync
    var filename = peer.filename

    fs.access(filename, function (err) {
      if (err) { // file doesn't exist, write
        if (self.opts.writeFormat === 'osm-p2p-syncfile') sync()
        else return onerror(new Error('unsupported syncfile type'))
      } else { // read
        isGzipFile(filename, function (err, isGzip) {
          if (err) return onerror(err)
          if (!isGzip) sync()
          else return onerror(new Error('unsupported syncfile type'))
        })
      }
    })

    function sync () {
      const syncfile = new Syncfile(filename, os.tmpdir())
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

      function onClose (err) {
        if (!open) return
        open = false
        if (peer.sync) {
          if (err) peer.sync.emit('error', err)
          else peer.sync.emit('end')
          self.emit('down', peer)
          debug('down', peer)
        }
        if (stream) stream.destroy()
      }

      function doSync () {
        if (!open) return
        // Set up the sync stream immediately, but don't do anything with it
        // until one side initiates the sync operation.
        var deviceType = self.opts.deviceType
        peer.deviceType = deviceType
        stream = MapeoSync(self.osm, self.media, {
          deviceType: deviceType,
          deviceName: self.name || os.hostname(),
          handshake: onHandshake
        })
        stream.once('sync-start', function () {
          if (++self._activeSyncs === 1) {
            self.osm.core.pause()
          }
        })
        stream.on('progress', (progress) => {
          if (peer.sync) peer.sync.emit('progress', progress)
        })
        pump(stream, connection, stream, function (err) {
          if (--self._activeSyncs === 0) {
            self.osm.core.resume()
          }
          if (!stream.goodFinish && !err) err = new Error('sync stream terminated on remote side')
          onClose(err)
        })
      }

      function onHandshake (req, accept) {
        peer.handshake = {
          accept: accept
        }
        // as soon as any data is received, accept! Because this means that
        // the other side just have accepted & wants to start.
        stream.once('accepted', function () {
          accept()
        })

        self.state.onwifi(peer)
        peer.deviceType = req.deviceType
        peer.name = req.deviceName
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
