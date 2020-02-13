module.exports = {
  dbState,
  mfState,
  getExpectedDownloadEvents,
  getExpectedUploadEvents
}

function dbState (db) {
  return mfState(db.core._logs)
}

function mfState (mf) {
  let state = {}
  mf.feeds().forEach(f => {
    state[f.key.toString('hex')] = f.length
  })
  return state
}

function getExpectedDownloadEvents (local, remote) {
  return Object.entries(remote).reduce((accum, [key,length]) => {
    if (!local[key]) accum += length
    else if (local[key] < length) accum += length - local[key]
    return accum
  }, 0)
}

function getExpectedUploadEvents (local, remote) {
  return getExpectedDownloadEvents(remote, local)
}

