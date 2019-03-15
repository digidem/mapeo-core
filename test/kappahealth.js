var hyperhealth = require('hyperhealth')

module.exports = function (core) {
  var healths = []
  healths.push(hyperhealth(core._logs._feeds.default))
  core._logs.writer(function (err, writer) {
    if (err) throw err
    healths.push(hyperhealth(writer))
  })
  core._logs.on('feed', function (feed) {
    healths.push(hyperhealth(core._logs._fake))
    healths.push(hyperhealth(feed))
  })
  function get () {
    return healths.map((h) => h.get())
  }

  return {
    get: get
  }
}
