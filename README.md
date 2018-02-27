# mapfilter-db

Media and observations store for osm-p2p.

## API

### `db = MapfilterDb(opts)`

### `db.mediaRead(name, cb)`

### `db.mediaCreate(filename, data, opts, cb)`

### `stream = db.createOsmReplicationStream()`

### `stream = db.createMediaReplicationStream()`

### `db.replicateWithDirectory(dir, opts, cb)`

### `db.observationCreate(feature, cb)`

### `db.observationUpdate(feature, cb)`

### `db.observationList(feature, cb)`

### `db.close(cb)`

## License

MIT
