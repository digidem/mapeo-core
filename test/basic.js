var path = require('path')
var os = require('os')
var tape = require('tape')
var rimraf = require('rimraf')
var itar = require('indexed-tarball')

var helpers = require('./helpers')

tape('fetch own device id', function (t) {
  t.plan(3)

  var api = helpers.createApi(null)

  api.getDeviceId(function (err, id) {
    t.error(err)
    t.ok(typeof id === 'string')
    t.ok(id.length === 64)
    api.close()
  })
})
