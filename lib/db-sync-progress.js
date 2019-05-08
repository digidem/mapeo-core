var eos = require('end-of-stream')
var throttle = require('lodash/throttle')

module.exports = function (db, opts) {
  var multifeed = db.osm.core._logs

  var stream = multifeed.replicate(opts)

  var feeds = []
  var progress = {}
  var listeners = []
  var throttledUpdateProgress = throttle(updateProgress, 200)

  multifeed.ready(function () {
    multifeed.feeds().forEach(onFeed)
    multifeed.on('feed', onFeed)

    eos(stream, function () {
      multifeed.removeListener('feed', onFeed)
      throttledUpdateProgress.flush()
      listeners.forEach(function (l) {
        l.feed.removeListener('download', l.listener)
      })
    })
  })

  return stream

  function onFeed (feed) {
    feeds.push(feed)
    function boundUpdate () {
      throttledUpdateProgress(feed)
    }
    feed.ready(boundUpdate)
    feed.on('download', boundUpdate)
    listeners.push({ feed: feed, listener: boundUpdate })
  }

  function updateProgress (feed) {
    progress[feed.key.toString('hex')] = feed.downloaded(0, feed.length)
    var total = feeds.reduce(function (acc, feed) { return acc + feed.length }, 0)
    var sofar = feeds.reduce(function (acc, feed) { return acc + feed.downloaded(0, feed.length) }, 0)
    stream.emit('progress', sofar, total)
  }
}
