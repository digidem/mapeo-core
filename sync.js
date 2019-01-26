const path = require('path')
const wsock = require('websocket-stream')
const wsockstream = require('websocket-stream/stream')
const http = require('http')
const createMediaReplicationStream = require('blob-store-replication-stream')
const sneakernet = require('hyperlog-sneakernet-replicator')
const Syncfile = require('osm-p2p-syncfile')
const debug = require('debug')('mapeo-sync')
const Bonjour = require('bonjour')
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

class Sync extends events.EventEmitter {
  constructor (osm, media, opts) {
    super()
    if (!opts) opts = {}
    opts.writeFormat = opts.writeFormat || 'hyperlog-sneakernet'
    if (!SYNCFILE_FORMATS[opts.writeFormat]) throw new Error('unknown syncfile write format: ' + opts.writeFormat)

    this.osm = osm
    this.media = media
    this.host = opts.host
    this.id = opts.id || 'Mapeo_' + randombytes(8).toString('hex')
    this.opts = opts
    this._targets = {}
    this._replicationServer = null
    this._onerror = this._onerror.bind(this)
  }

  targets () {
    return values(this._targets)
  }

  /**
   * Sync to Target
   * @type {[type]}
   */
  syncToTarget (_target, opts) {
    var self = this
    if (!opts) opts = {}

    const emitter = new events.EventEmitter()
    const url = `ws://${_target.host}:${_target.port}`

    var pending = 2
    var target = this._targets[_target.name]

    const done = (err) => {
      if (err) {
        if (target) {
          target.status = 'replication-error'
          target.message = err.message
        }
        return emitter.emit('error', err)
      }
      if (--pending === 0) {
        if (target) {
          target.status = 'replication-complete'
        }
        emitter.emit('end')
      }
    }
    emitter.emit('progress', 'replication-started')
    if (target) target.status = 'replication-started'

    const ws = wsock(`${url}/osm`, {
      perMessageDeflate: false, objectMode: true
    })
    // TODO: real progress events
    ws.once('data', () => {
      if (target) target.status = 'osm-connected'
      emitter.emit('progress', 'osm-connected')
    })

    const osm = self.osmReplicationStream(opts.osm)
    replicate(osm, ws, done)

    const ws2 = wsock(`${url}/media`, {
      perMessageDeflate: false, objectMode: true
    })
    // TODO: real progress events
    ws2.once('data', () => {
      if (target) target.status = 'media-connected'
      emitter.emit('progress', 'media-connected')
    })
    const media = self.mediaReplicationStream(opts.media)
    replicate(media, ws2, done)
    return emitter
  }

  /**
   * Convenience function for announcing and re-announcing
   */
  announce (opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    if (!this.browser) {
      this.browser = this.listen(Object.assign({}, this.opts, opts), cb)
    } else {
      this.browser.update()
      cb()
    }
  }

  /**
   * Convenience function for unanouncing and leaving the swarm
   */
  unannounce (cb) {
    var self = this
    self._targets = {}
    if (!self.bonjour) return cb()
    self.bonjour.unpublishAll(function () {
      self.browser = null
      if (self._replicationServer) {
        self._replicationServer.close(cb)
        self._replicationServer = null
      } else cb()
    })
  }

  _onerror (err) {
    this.emit('error', err)
  }

  /**
   * Broadcast and listen to targets on mdns
   */
  listen (opts, cb) {
    var self = this
    if (!opts) opts = {}
    if (!cb) cb = function () {}
    self._targets = {}
    const type = opts.type || SYNC_TYPE
    if (!this.bonjour) this.bonjour = Bonjour()
    this._replicationServer = http.createServer(function (req, res) {})
    const wss = wsock.createServer({noServer: true})

    this._replicationServer.on('upgrade', function (req, socket, head) {
      wss.handleUpgrade(req, socket, head, function (client) {
        var stream
        if (req.url === '/osm') stream = self.osmReplicationStream(opts.osm)
        if (req.url === '/media') stream = self.mediaReplicationStream(opts.media)
        if (!stream) return client.send('Not found')
        replicate(stream, wsockstream(client), function (err) {
          if (err) self._onerror(err)
        })
      })
    })
    wss.on('error', this._onerror)
    this._replicationServer.on('error', this._onerror)
    this._replicationServer.listen(done)

    function done () {
      debug('replication server live on port', self._replicationServer.address().port)
      self.service = self.bonjour.publish({
        name: self.id,
        host: self.host,
        type: type,
        port: self._replicationServer.address().port
      })
      self.service.on('error', self._onerror)
      self.service.once('up', cb)
    }

    const browser = this.bonjour.find({ type }, this._onerror)
    browser.on('down', function (service) {
      const target = WifiTarget(service)
      self.emit('down', target)
      debug('down', target)
      delete self._targets[target.name]
    })

    browser.on('up', function (service) {
      // Skip your own machine.
      if (service.name === self.id) {
        debug('skipping sync target: it\'s me')
        return
      }

      const target = WifiTarget(service)
      self._targets[target.name] = target
      self.emit('connection', target)
      debug('connection', target)
    })
    return browser
  }

  /**
   * Replicate from a given file
   * @param  {String}   path    The target source filepath
   * @return {EventEmitter}     Listen to 'error', 'end' and 'progress' events
   */
  replicateFromFile (sourceFile) {
    var self = this
    const emitter = new events.EventEmitter()
    const target = {
      id: this.id,
      name: path.basename(sourceFile),
      filename: sourceFile,
      type: 'file'
    }
    self._targets[target.name] = target

    // FIXME: this wraps & re-wraps the function each time this func is called!
    const replicateOrig = this.osm.log.replicate
    this.osm.log.replicate = function () {
      const stream = replicateOrig.call(self.osm.log)
      stream.on('data', function () {
        target.status = 'replication-progress'
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
      target.status = 'replication-error'
      target.message = err.message
      emitter.emit('error', err)
    }

    function onend (err) {
      if (err) return onerror(err)
      target.status = 'replication-complete'
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
    if (!cb) cb = function () {}
    var self = this
    self.unannounce(function () {
      if (!self.bonjour) return cb()
      self.bonjour.destroy()
      self.bonjour = undefined
      cb()
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

function WifiTarget (service) {
  return {
    id: service.name,
    name: service.host,
    host: service.referer.address,
    port: service.port,
    type: 'wifi'
  }
}

module.exports = Sync
