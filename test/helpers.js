var mkdirp = require('mkdirp')
var path = require('path')
var fs = require('fs')
var pump = require('pump')
var rimraf = require('rimraf')
var randombytes = require('randombytes')
var osmdb = require('kappa-osm')
var kappa = require('kappa-core')
var raf = require('random-access-file')
var level = require('level')
var blobstore = require('safe-fs-blob-store')
var tmp = require('tmp')
var mock = require('mock-data')

var Mapeo = require('..')

module.exports = {
  createApi,
  writeBigData,
  generateObservations
}

function createApi (_, opts) {
  var dir = tmp.dirSync().name

  rimraf.sync(dir)
  mkdirp.sync(dir)

  var osm = osmdb({
    core: kappa(dir, {valueEncoding: 'json'}),
    index: level(path.join(dir, 'index')),
    storage: function (name, cb) {
      process.nextTick(cb, null, raf(path.join(dir, 'storage', name)))
    }
  })

  var media = blobstore(path.join(dir, 'media'))

  return new Mapeo(osm, media, Object.assign({}, opts, {
    id: randombytes(8).toString('hex')
  }))
}

function writeBigData (mapeo, n, cb) {
  var total = n
  var toFinish = 0
  generateObservations(n, function (_, obs) {
    mapeo.observationCreate(obs, (_, node) => {
      n--
      var ws = mapeo.media.createWriteStream(`preview/foo-${n}.jpg`)
      var rs = fs.createReadStream(path.join(__dirname, 'hi-res.jpg'))
      pump(rs, ws, function (err) {
        if (err) return cb(err)
        var ws = mapeo.media.createWriteStream(`thumbnail/foo-${n}.jpg`)
        var rs = fs.createReadStream(path.join(__dirname, 'hi-res.jpg'))
        pump(rs, ws, function (err) {
          if (err) return cb(err)
          var ws = mapeo.media.createWriteStream(`original/foo-${n}.jpg`)
          var rs = fs.createReadStream(path.join(__dirname, 'hi-res.jpg'))
          pump(rs, ws, function (err) {
            if (err) return cb(err)
            toFinish++
            console.log(`wrote ${toFinish}/${total}`)
            if (toFinish === total) return cb()
          })
        })
      })
    })
  })
}

function generateObservations (count, bounds, cb) {
  if (!cb && typeof bounds === 'function') {
    cb = bounds
    bounds = [-78.3155, -3.3493, -74.9871, 0.6275]
    bounds = bounds.map((b) => b * 100)
  }
  mock.generate({
    type: 'integer',
    count: count,
    params: { start: bounds[0], end: bounds[2] }
  }, function (err, lons) {
    if (err) return cb(err)
    mock.generate({
      type: 'integer',
      count: count,
      params: { start: bounds[1], end: bounds[3] }
    }, function (err, lats) {
      if (err) return cb(err)
      lons.forEach((lon, i) => {
        var obs = {
          type: 'observation',
          lat: lats[i] / 100,
          lon: lon / 100,
          tags: {
            notes: '',
            observedBy: 'you'
          }
        }
        cb(null, obs)
      })
    })
  })
}
