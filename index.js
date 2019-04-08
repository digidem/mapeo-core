const randombytes = require('randombytes')
const events = require('events')

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

    this.osm.create(newObs, function (err, node) {
      if (err) return cb(err)
      cb(null, node)
    })
  }

  observationGet (id, cb) {
    this.osm.get(id, function (err, elms) {
      if (err) return cb(err)
      else return cb(null, elms.map(toObs).map(transformOldObservation))
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
    this.osm.del(id, {}, cb)
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
    return this.osm.byType('observation', opts)
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

// All valid top-level props
var TOP_LEVEL_PROPS = USER_UPDATABLE_PROPS.concat([
  'created_at',
  'timestamp',
  'id',
  'version',
  'type',
  'links'
])

// Props from old versions of mapeo-mobile that we can discard
var SKIP_OLD_PROPS = [
  'created_at_timestamp',
  'link',
  'device_id',
  'observedBy'
]

function transformOldObservation (obs) {
  switch (getSchemaVersion(obs)) {
    case 1:
      return transformObservationSchema1(obs)
    case 2:
      return transformObservationSchema2(obs)
    default:
      return obs
  }
}

// Transform an observation from Sinangoe version of MM to the current format
function transformObservationSchema1 (obs) {
  var newObs = { tags: {} }
  Object.keys(obs).forEach(function (prop) {
    if (prop === 'attachments') {
      // Attachments has changed from array of strings to array of objects
      newObs.attachments = (obs.attachments || []).map(a => {
        if (typeof a !== 'string') return a
        return { id: a }
      })
    } else if (prop === 'fields') {
      // fields.answer should be a tag
      newObs.fields = obs.fields || []
      newObs.fields.forEach(f => {
        if (!f || !f.answer || !f.id) return
        newObs.tags[f.id] = f.answer
      })
    } else if (SKIP_OLD_PROPS.indexOf(prop) > -1) {
      // just ignore unused old props
    } else if (TOP_LEVEL_PROPS.indexOf(prop) > -1) {
      // Copy across valid top-level props
      newObs[prop] = obs[prop]
    } else if (prop === 'created') {
      // created is changed to created_at
      newObs.created_at = obs.created
    } else {
      newObs.tags[prop] = obs[prop]
    }
  })
  return newObs
}

function toObs (elm) {
  return elm
  // TODO: sometimes the version is not here why?
  var obs = elm.element
  obs.id = elm.id
  obs.version = elm.version
  return obs
}

// Transform an observation from ECA version of MM to the current format
function transformObservationSchema2 (obs) {
  var newObs = Object.assign({}, obs, {tags: {}})
  Object.keys(obs.tags || {}).forEach(function (prop) {
    if (prop === 'fields') {
      newObs.fields = obs.tags.fields
    } else if (prop === 'created') newObs.created_at = obs.tags.created
    else newObs.tags[prop] = obs.tags[prop]
  })
  return newObs
}

// Get the schema version of the observation
// Prior to schema 3 we had two beta testing schemas in the wild
// which did not have a schemaVersion property
function getSchemaVersion (obs) {
  if (obs.schemaVersion) return obs.schemaVersion
  if (typeof obs.device_id === 'string' &&
    typeof obs.created === 'string' &&
    typeof obs.tags === 'undefined') return 1
  if (typeof obs.created_at === 'undefined' &&
    typeof obs.tags !== 'undefined' &&
    typeof obs.tags.created === 'string') return 2
  return null
}

Mapeo.errors = errors
Mapeo.CURRENT_SCHEMA = CURRENT_SCHEMA
module.exports = Mapeo
