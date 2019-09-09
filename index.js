const randombytes = require('randombytes')
const events = require('events')
const pumpify = require('pumpify')
const through = require('through2')
const parallel = require('run-parallel')
const pump = require('pump')
const fs = require('fs')
const shapefile = require('shp-write')
const concat = require('concat-stream')

const exportGeoJson = require('./lib/export-geojson')
const Importer = require('./lib/importer')
const Sync = require('./sync')
const errors = require('./errors')

const CURRENT_SCHEMA = 3

class Mapeo extends events.EventEmitter {
  constructor (osm, media, opts) {
    super()
    if (!opts) opts = {}
    this.sync = new Sync(osm, media, opts)
    this.sync.on('error', (err) => {
      this.emit('error', err)
    })
    this.osm = osm
    this.media = media
    this.importer = Importer(osm)
  }

  observationCreate (obs, cb) {
    try {
      validateObservation(obs)
    } catch (err) {
      return cb(errors.InvalidFields(err.message))
    }

    const newObs = whitelistProps(obs)
    newObs.type = 'observation'
    newObs.schemaVersion = obs.schemaVersion || CURRENT_SCHEMA
    newObs.timestamp = (new Date().toISOString())
    newObs.created_at = (new Date()).toISOString()
    if (obs.id) this.osm.put(obs.id, newObs, done)
    else this.osm.create(newObs, done)

    function done (err, node) {
      if (err) return cb(err)
      cb(null, node)
    }
  }

  observationGet (id, cb) {
    this.osm.get(id, function (err, elms) {
      if (err) return cb(err)
      else return cb(null, elms)
    })
  }

  observationConvert (id, cb) {
    var self = this
    // 1. get the observation
    this.osm.get(id, function (err, obses) {
      if (err) return cb(err)
      if (!obses.length) {
        return cb(new Error('failed to lookup observation: not found'))
      }

      // 2. see if tags.element_id already present (short circuit)
      var obs = obses[0]
      if (obs.tags && obs.tags.element_id) {
        cb(null, obs.tags.element_id)
        return
      }

      var batch = []

      // 3. create node
      batch.push({
        type: 'put',
        id: randombytes(8).toString('hex'),
        value: Object.assign({}, obs, {
          type: 'node'
        })
      })

      // 4. modify observation tags
      obs.tags = obs.tags || {}
      obs.tags.element_id = batch[0].id
      delete obs.links  // otherwise [] will be used, signalling that this is a fork
      batch.push({
        type: 'put',
        id: id,
        value: obs
      })

      // 5. batch modification
      self.osm.batch(batch, function (err) {
        if (err) return cb(err)
        return cb(null, obs.tags.element_id)
      })
    })
  }

  observationUpdate (newObs, cb) {
    var self = this
    if (typeof newObs.version !== 'string') {
      return cb(new Error('the given observation must have a "version" set'))
    }
    var id = newObs.id

    try {
      validateObservation(newObs)
    } catch (err) {
      return cb(errors.InvalidFields(err.message))
    }

    this.osm.getByVersion(newObs.version, function (err, obs) {
      if (err && !err.notFound) return cb(err)
      if (err && err.notFound) return cb(errors.NoVersion())
      if (obs.id !== id) return cb(errors.TypeMismatch(obs.id, id))

      var opts = {
        links: [newObs.version]
      }

      var finalObs = whitelistProps(newObs)
      finalObs.type = 'observation'
      finalObs.timestamp = new Date().toISOString()
      finalObs = Object.assign(obs, finalObs)

      self.osm.put(id, finalObs, opts, function (err, node) {
        if (err) return cb(err)
        return cb(null, node)
      })
    })
  }

  observationDelete (id, cb) {
    this.observationGet(id, (err, obses) => {
      if (err) return cb(err)
      if (!obses.length) return cb(new Error('Observation with id does not exist'))
      this.osm.del(id, {}, (err) => {
        if (err) return cb(err)
        var tasks = []

        var attachmentIds = {}
        obses.forEach(obs => {
          if (!obs.attachments) return
          obs.attachments.map((a) => {
            console.log('gonna del', a)
            // only delete files once
            if (attachmentIds[a.id]) return
            attachmentIds[a.id] = true
            // okay delete now
            tasks.push((done) => {
              var filename = 'original/' + a.id
              this.media.remove(filename, done)
            })
            tasks.push((done) => {
              var filename = 'preview/' + a.id
              this.media.remove(filename, done)
            })
            tasks.push((done) => {
              var filename = 'thumbnail/' + a.id
              this.media.remove(filename, done)
            })
          })
        })
        parallel(tasks, cb)
      })
    })
  }

  observationList (opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    var results = []
    this.observationStream(opts)
      .on('data', function (obs) {
        results.push(obs)
      })
      .once('end', function () {
        cb(null, results)
      })
      .once('error', function (err) {
        cb(err)
      })
  }

  observationStream (opts) {
    opts = opts || {}

    var latest = {}
    var removeForks = through.obj(function (row, enc, next) {
      if (!latest[row.id]) latest[row.id] = row
      else if (row.timestamp > latest[row.id].timestamp) latest[row.id] = row
      // If the timestamps are equal (can happen!) then return by latest version
      // to ensure that the results are deterministic. Equal timestamps is only
      // likely to occur on the same hypercore anyway, so this will return the
      // latest sequence number if timestamps are equal.
      else if (row.timestamp === latest[row.id].timestamp && row.version > latest[row.id].version) latest[row.id] = row
      next()
    }, function (cb) {
      Object.keys(latest).forEach(k => this.push(latest[k]))
      cb()
    })

    var removeDeleted = through.obj(function (row, enc, next) {
      if (row.deleted) next()
      else next(null, row)
    })

    if (opts.forks) {
      return pumpify.obj(this.osm.byType('observation', opts), removeDeleted)
    } else {
      return pumpify.obj(this.osm.byType('observation', opts), removeDeleted, removeForks)
    }
  }

  exportData (filename, opts, cb) {
    if (!cb && typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    if (!opts.format) opts.format = 'geojson'
    var GeoJSONStream = exportGeoJson(this.osm, opts)
    switch (opts.format) {
      case 'geojson': return pump(GeoJSONStream, fs.createWriteStream(filename), cb)
      case 'shapefile':
        GeoJSONStream.pipe(concat((geojson) => {
          var zipStream = shapefile.zipStream(JSON.parse(geojson))
          pump(zipStream, fs.createWriteStream(filename), cb)
        }))
        return
      default: return cb(new Error('Extension not supported'))
    }
  }

  getDeviceId (cb) {
    cb = cb || noop
    this.osm.ready(() => {
      cb(null, this.osm.writer.key.toString('hex'))
    })
  }

  close (cb) {
    this.sync.close(cb)
  }
}

function validateObservation (obs) {
  if (!obs) throw new Error('Observation is undefined')
  if (obs.type !== 'observation') throw new Error('Observation must be of type `observation`')
  if (obs.attachments) {
    if (!Array.isArray(obs.attachments)) throw new Error('Observation attachments must be an array')
    obs.attachments.forEach(function (att, i) {
      if (!att) throw new Error('Attachment at index `' + i + '` is undefined')
      if (typeof att.id !== 'string') throw new Error('Attachment must have a string id property (at index `' + i + '`)')
    })
  }
  if (typeof obs.lat !== 'undefined' || typeof obs.lon !== 'undefined') {
    if (typeof obs.lat === 'undefined' || typeof obs.lon === 'undefined') {
      throw new Error('one of lat and lon are undefined')
    }
    if (typeof obs.lat !== 'number' || typeof obs.lon !== 'number') {
      throw new Error('lon and lat must be a number')
    }
  }
}

// Top-level props that can be modified by the user/client
var USER_UPDATABLE_PROPS = [
  'lon',
  'lat',
  'attachments',
  'tags',
  'ref',
  'metadata',
  'fields',
  'schemaVersion'
]

// Filter whitelisted props the user can update
function whitelistProps (obs) {
  var newObs = {}
  USER_UPDATABLE_PROPS.forEach(function (prop) {
    if (obs[prop]) newObs[prop] = obs[prop]
  })
  return newObs
}

function noop () {}

Mapeo.errors = errors
Mapeo.CURRENT_SCHEMA = CURRENT_SCHEMA
module.exports = Mapeo
