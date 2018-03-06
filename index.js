var randomBytes = require('randombytes')
var collect = require('collect-stream')
var mkdirp = require('mkdirp')
var pump = require('pump')
var xtend = require('xtend')
var through = require('through2')
var level = require('level')
var osmdb = require('osm-p2p')
var osmobs = require('osm-p2p-observations')
var MediaStore = require('safe-fs-blob-store')
var sneakernet = require('hyperlog-sneakernet-replicator')
var path = require('path')
var createMediaReplicationStream = require('blob-store-replication-stream')

module.exports = Store

function Store (osmdir) {
  if (!(this instanceof Store)) return new Store(osmdir)
  var mediadir = path.join(osmdir, 'media')
  mkdirp.sync(mediadir)
  var obsdb = level(path.join(osmdir, 'obsdb'))
  this.media = MediaStore(mediadir)
  this.osm = osmdb(osmdir)
  this.obs = osmobs({ db: obsdb, log: this.osm.log })
}

Store.prototype.mediaRead = function (name, cb) {
  collect(this.media.createReadStream(name), cb)
}

Store.prototype.mediaCreate = function (filename, data, opts, cb) {
  if (arguments.length === 3 && typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  const ws = this.media.createWriteStream(filename, function (err) {
    cb(err, 'mapfilter://' + filename)
  })
  ws.end(data)
}


Store.prototype.createOsmReplicationStream = function () {
  return this.osm.log.replicate()
}

Store.prototype.createMediaReplicationStream = function () {
  return createMediaReplicationStream(this.media)
}

Store.prototype.close = function (cb) {
  this.osm.close(cb)
}

Store.prototype.replicateWithDirectory = function (dir, opts, done) {
  var pending = 2
  var errs = []
  var dataPath = path.join(dir, 'data.tgz')
  var mediaPath = path.join(dir, 'media')

  sneakernet(this.osm.log, {safetyFile: true}, dataPath, onFinished)
  var dest = MediaStore(mediaPath)
  var r1 = this.replicateMediaReplicationStream()
  var r2 = createMediaReplicationStream(dest)
  pump(r1, r2, r1, onFinished)

  function onFinished (err) {
    if (err) errs.push(err)
    if (--pending > 0) return
    var txt = 'DO NOT MODIFY ANYTHING INSIDE THIS FOLDER PRETTY PLEASE'
    fs.writeFile(path.join(dir, 'DO NOT MODIFY.txt'), txt, 'utf8', onWritten)
  }

  function onWritten (err) {
    if (err) errs.push(err)
    done(errs.length ? errs : null)
  }
}

Store.prototype.observationCreate = function (feature, cb) {
  if (!(feature.type === 'Feature' && feature.properties)) {
    return cb(new Error('Expected GeoJSON feature object'))
  }
  var obs = {
    type: 'observation',
    tags: feature.properties,
    timestamp: new Date().toISOString()
  }
  if (feature.geometry && feature.geometry.coordinates) {
    obs.lon = feature.geometry.coordinates[0]
    obs.lat = feature.geometry.coordinates[1]
  }
  var id = feature.id ? feature.id + '' : randomBytes(8).toString('hex')
  this.osm.put(id, obs, cb)
}

Store.prototype.observationDelete = function (id, cb) {
  this.osm.del(id, cb)
}

Store.prototype.observationUpdate = function (feature, cb) {
  this.observationCreate(feature, cb)
}

Store.prototype.observationStream = function (opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  return this.osm.kv.createReadStream(opts).pipe(through.obj(write))

  function write (row, enc, next) {
    var values = Object.keys(row.values || {}).map(v => row.values[v])
    if (!values.length) return next()
    if (values[0].deleted) return next()
    if (values[0].value.type === 'observation') {
      var obs = xtend(values[0].value, {id: row.key})
      return next(null, obs)
    }
    return next()
  }
}

Store.prototype.observationList = function (opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  collect(this.observationStream(opts), function (err, data) {
    if (err) return cb(err)
    cb(null, data)
  })
}
