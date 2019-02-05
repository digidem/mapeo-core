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

function WifiTarget (peer) {
  peer.type = 'wifi'
  return peer
}

function FileTarget (filename) {
  return {
    id: path.basename(filename),
    filename,
    type: 'file'
  }
}

class Sync extends events.EventEmitter {
  constructor (osm, media, opts) {
    super()
    this.opts = Object.assign(DEFAULT_OPTS, opts)
    opts.writeFormat = opts.writeFormat || 'hyperlog-sneakernet'
    if (!SYNCFILE_FORMATS[opts.writeFormat]) throw new Error('unknown syncfile write format: ' + opts.writeFormat)

    this.osm = osm
    this.media = media
    this.id = opts.id || randombytes(8).toString('hex')
    this.opts = opts

    // track replication progress states of files and wifi streams
    this._targets = {}

    this.swarm = null
  }

  _swarm () {
    this.swarm = Swarm()
    this.swarm.on('connection-closed', (connection, info) => {
      const target = WifiTarget(info)
      this.emit('down', target)
      debug('down', target)
      delete this._targets[target.id]
    })

    this.swarm.on('connection', (connection, info) => {
      // Skip your own machine.
      if (info.id === this.id) {
        debug('skipping sync target: it\'s me')
        return
      }

      const target = WifiTarget(info)
      this._targets[target.id] = target
      this.emit('connection', target)
      debug('connection', target)
    })
    this._onerror = this._onerror.bind(this)
  }

  targets () {
    return values(this._targets)
  }

  syncToTarget (_target, opts) {
  }

  _syncError (err, target) {
    target.status = 'replication-error'
    target.message = err.message
  }

  _syncComplete (target) {
    target.status = 'replication-complete'
  }

  // FIXME: think about this API more
  _syncProgress (target, percent) {
    target.status = 'replication-progress'
    target.percent = percent
  }

  _onMediaProgress (target, percent) {
    target.status = 'media-connected'
  }

  _onOsmProgress (target, percent) {
    target.status = 'osm-connected'
  }

  /**
   * Convenience function for unanouncing and leaving the swarm
   */
  unannounce (cb) {
    if (!this.swarm) return cb()
    this.swarm.leave(SYNC_TYPE)
  }

  _onerror (err) {
    this.emit('error', err)
  }

  listen (opts, cb) {
    this.swarm.listen(Object.assign({}, this.opts, opts), cb)
  }

  /**
   * Broadcast and listen to targets on mdns
   */
  announce (opts, cb) {
    if (this.swarm) return cb()
    this.listen(opts, () => this.swarm.join(SYNC_TYPE, cb))
  }

  /**
   * Replicate from a given file
   * @param  {String}   path    The target source filepath
   * @return {EventEmitter}     Listen to 'error', 'end' and 'progress' events
   */
  replicateFromFile (sourceFile) {
    var self = this
    const emitter = new events.EventEmitter()

    const target = FileTarget(sourceFile)
    self._targets[target.id] = target

    // FIXME: this wraps & re-wraps the function each time this func is called!
    const replicateOrig = this.osm.log.replicate
    this.osm.log.replicate = function () {
      const stream = replicateOrig.call(self.osm.log)
      stream.on('data', function () {
        self._syncProgress(target)
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
        replicate(r1, r2, fin)
        replicate(m1, m2, fin)
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
      self._syncError(err, target)
      emitter.emit('error', err)
    }

    function onend (err) {
      if (err) return onerror(err)
      self._syncComplete(target)
      self.osm.ready(function () {
        emitter.emit('end')
      })
    }

    return emitter
  }

  osmReplicationStream (opts) {
    return this.osm.log.replicate(opts)
  }

  mediaReplicationStream (opts) {
    return createMediaReplicationStream(this.media, opts)
  }

  close (cb) {
    if (!cb) cb = () => {}
    this.unannounce(() => {
      this.swarm.destroy(() => {
        this.swarm = null
      })
    })
  }
}

function replicate (a, b, cb) {
  var pending = 2
  a.once('end', checkDone)
  a.once('finish', checkDone)
  a.once('error', checkDone)
  b.once('end', checkDone)
  b.once('finish', checkDone)
  b.once('error', checkDone)
  function checkDone () {
    if (!--pending) cb()
  }
  a.pipe(b).pipe(a)
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

module.exports = Sync
