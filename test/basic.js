var tape = require('tape')

var helpers = require('./helpers')

tape('basic: fetch own device id', function (t) {
  t.plan(3)

  helpers.createApi(function (api, close) {
    api.getDeviceId(function (err, id) {
      t.error(err)
      t.ok(typeof id === 'string')
      t.ok(id.length === 64)
      close()
    })
  })
})
