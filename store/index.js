'use strict'

var assert = require('assert')
var extend = require('xtend')
var updateStruct = require('soft-update-struct')
var dotProp = require('dot-prop')
var partial = require('ap').partial
var VarHash = require('observ-varhash')
var WeakStore = require('weakmap-shim/create-store')
var watch = require('../watch')
var toPathValues = require('../util/to-path-values')
var joinPaths = require('../util/join-paths')
var isEqual = require('../util/is-equal')
var setNonEnumerable = require('../util/set-non-enumerable')
var errors = require('../errors')

var unlisteners = WeakStore()

var defaults = {
  parse: identity
}

function defaultThrowIfError (error) {
  if (error) throw error
}

function identity (n) { return n }

module.exports = function Store (model, options) {
  options = extend(defaults, options)

  assert.equal(typeof options.construct, 'function', 'function options.construct required')
  assert.equal(typeof options.parse, 'function', 'function options.parse required')
  assert.ok(Array.isArray(options.paths), 'array options.paths required')
  assert.ok(Array.isArray(options.prefix), 'array options.prefix required')

  var prefix = options.prefix
  var paths = options.paths

  var state = VarHash({})
  var _put = state.put
  var _delete = state.delete

  setNonEnumerable(state, {
    paths: getPaths,
    prefix: getPrefix,
    has: has,
    delete: del,
    put: put,
    save: save,
    fetch: fetch
  })

  return state

  function getPaths () {
    return paths
  }

  function getPrefix () {
    return prefix
  }

  function has (id) {
    return state.get(id) != null
  }

  function del (id) {
    if (!state.has(id)) return

    var unlisten = unlisteners(state.get(id)).unlisten
    if (unlisten) unlisten()
    _delete(id)
  }

  function put (id, data) {
    if (state.has(id)) return state.get(id)

    var value = options.construct(options.parse(data))
    assert.ok(typeof value === 'function' && typeof value.set === 'function',
              'options.construct must return an observ instance')

    var unlisten = watch(model, prefix.concat(id), partial(handleChange, id))

    _put(id, value)
    unlisteners(value).unlisten = unlisten

    return value
  }

  function fetch (id, callback) {
    callback = callback || defaultThrowIfError

    if (state.has(id)) return callback(null, state.get(id))

    getData(id, {local: false}, onFetchData)

    function onFetchData (error, data) {
      if (error) return callback(error)

      if (state.has(id)) {
        handleChange(id, callback)
      } else {
        callback(null, state.put(id, data))
      }
    }
  }

  function save (id, data, callback) {
    callback = callback || defaultThrowIfError

    var pathValues = toPathValues(data, prefix.concat(id))

    model.setLocal(pathValues, function (error) {
      if (error) return callback(error)
      fetch(id, callback)
    })
  }

  function handleChange (id, callback) {
    callback = callback || defaultThrowIfError

    getData(id, {local: true}, onData)

    function onData (error, data) {
      if (error) return callback(error)

      var update = options.parse(data)
      var value = state.get(id)
      if (value._type === 'observ-struct') {
        updateStruct(value, update, isEqual)
      } else {
        value.set(update)
      }
      callback(null, value)
    }
  }

  function getData (id, opts, callback) {
    var method = opts.local ? 'getLocal' : 'get'
    model[method](joinPaths(prefix.concat(id), paths), onGetData)

    function onGetData (error, graph) {
      if (error || !graph) {
        return callback(new errors.DataNotFoundError(
          'No data found at prefix ' + JSON.stringify(prefix.concat(id)) + ', paths ' + JSON.stringify(paths),
          error
        ))
      }

      var data = dotProp.get(graph.json, prefix.concat(id).join('.'))
      callback(null, data)
    }
  }
}
