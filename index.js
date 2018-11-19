const through = require('through2')
const randombytes = require('randombytes')

const Sync = require('./sync')
const errors = require('./errors')

class Core {
  constructor (osm, media, opts) {
    if (!opts) opts = {}
    this.sync = new Sync(osm, media, opts)
    this.osm = osm
    this.media = media
  }

  observationCreate (obs, cb) {
    try {
      validateObservation(obs)
    } catch (err) {
      return cb(errors.InvalidFields(err.message))
    }

    const newObs = whitelistProps(obs)
    newObs.type = 'observation'
    newObs.timestamp = (new Date().toISOString())

    this.osm.create(newObs, function (err, _, node) {
      if (err) return cb(err)
      newObs.id = node.value.k
      newObs.version = node.key
      cb(null, newObs)
    })
  }

  observationGet (id, cb) {
    this.osm.get(id, function (err, obses) {
      if (err) return cb(err)
      else return cb(null, flatObs(id, obses))
    })
  }

  observationConvert (id, cb) {
    var self = this
    // 1. get the observation
    this.osm.get(id, function (err, obses) {
      if (err) return cb(err)
      if (!Object.keys(obses).length) {
        return cb(new Error('failed to lookup observation: not found'))
      }

      // 2. see if tags.element_id already present (short circuit)
      var obs = obses[Object.keys(obses)[0]]
      if (obs.tags && obs.tags.element_id) {
        cb(null, obs.tags.element_id)
        return
      }

      var batch = []

      // 3. create node
      batch.push({
        type: 'put',
        key: randombytes(8).toString('hex'),
        value: Object.assign(obs, {
          type: 'node'
        })
      })

      // 4. modify observation tags
      obs.tags = obs.tags || {}
      obs.tags.element_id = batch[0].key
      batch.push({
        type: 'put',
        key: id,
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
        finalObs.id = node.value.k
        finalObs.version = node.key
        return cb(null, finalObs)
      })
    })
  }

  observationDelete (id, cb) {
    this.osm.del(id, cb)
  }

  observationList (cb) {
    var results = []
    this.osm.kv.createReadStream()
      .on('data', function (row) {
        Object.keys(row.values).forEach(function (version) {
          var obs = row.values[version].value
          if (!obs) return
          if (obs.type !== 'observation') return
          obs.id = row.key
          obs.version = version
          results.push(obs)
        })
      })
      .once('end', function () {
        cb(null, results)
      })
      .once('error', function (err) {
        cb(err)
      })
  }

  observationStream () {
    var parseObs = through.obj(function (enc, obj, next) {
      if (obj.type === 'observation') return next(null, obj)
      return next()
    })

    return this.osm.kv.createReadStream().pipe(parseObs)
  }

  close (cb) {
    this.sync.close(cb)
  }
}

function flatObs (id, obses) {
  return Object.keys(obses).map(function (version) {
    var obs = obses[version]
    obs.id = id
    obs.version = version
    return obs
  })
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

var VALID_PROPS = ['lon', 'lat', 'attachments', 'tags', 'ref']

// Filter whitelisted props
function whitelistProps (obs) {
  var newObs = {}
  VALID_PROPS.forEach(function (prop) {
    newObs[prop] = obs[prop]
  })
  return newObs
}

module.exports = Core
Core.errors = errors
