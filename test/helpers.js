var mkdirp = require('mkdirp')
var path = require('path')
var rimraf = require('rimraf')
var randombytes = require('randombytes')
var osmdb = require('kappa-osm')
var kappa = require('kappa-core')
var raf = require('random-access-file')
var level = require('level')
var blobstore = require('safe-fs-blob-store')
var tmp = require('tmp')

var Mapeo = require('..')

module.exports = {
  createApi
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
