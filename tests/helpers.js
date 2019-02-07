var mkdirp = require('mkdirp')
var tmp = require('os-tmpdir')
var path = require('path')
var rimraf = require('rimraf')
var randombytes = require('randombytes')
var Osm = require('osm-p2p-mem')
var blobstore = require('safe-fs-blob-store')

var Mapeo = require('..')

var tmpdir = path.join(tmp(), 'mapfilter-sync-server-test-files')
var tmpdir2 = path.join(tmp(), 'mapfilter-sync-server-test-files-2')

module.exports = {
  tmpdir, tmpdir2, createStore, cleanup
}

function createStore (dir, opts) {
  rimraf.sync(dir)
  mkdirp.sync(dir)
  var osm = Osm()
  var media = blobstore(dir)
  return new Mapeo(osm, media, Object.assign({}, opts, {
    id: randombytes(8).toString('hex')
  }))
}

function cleanup () {
  rimraf.sync(tmpdir)
  rimraf.sync(tmpdir2)
}
