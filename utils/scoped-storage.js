function hasStorageKey(key) {
  if (!key) return false
  try {
    const info = wx.getStorageInfoSync()
    const keys = (info && info.keys) || []
    return keys.indexOf(key) !== -1
  } catch (e) {
    return false
  }
}

function resolveActiveUserKey(app) {
  try {
    if (app && typeof app.getActiveUserKey === 'function') {
      return app.getActiveUserKey() || ''
    }
    return wx.getStorageSync('activeUserKey') || ''
  } catch (e) {
    return ''
  }
}

function scopedKey(baseKey, userKey) {
  return `${baseKey}__${userKey}`
}

function readRaw(key, fallbackValue) {
  try {
    if (!hasStorageKey(key)) return fallbackValue
    const value = wx.getStorageSync(key)
    return value === '' && typeof fallbackValue !== 'undefined' ? fallbackValue : value
  } catch (e) {
    return fallbackValue
  }
}

function getScoped(app, key, fallbackValue) {
  if (app && typeof app.getScopedStorage === 'function') {
    return app.getScopedStorage(key, fallbackValue)
  }

  const userKey = resolveActiveUserKey(app)
  if (userKey) {
    return readRaw(scopedKey(key, userKey), fallbackValue)
  }
  return readRaw(key, fallbackValue)
}

function setScoped(app, key, value) {
  if (app && typeof app.setScopedStorage === 'function') {
    app.setScopedStorage(key, value)
    return
  }
  try {
    const userKey = resolveActiveUserKey(app)
    wx.setStorageSync(userKey ? scopedKey(key, userKey) : key, value)
  } catch (e) {}
}

function removeScoped(app, key) {
  if (app && typeof app.removeScopedStorage === 'function') {
    app.removeScopedStorage(key)
    return
  }
  try {
    const userKey = resolveActiveUserKey(app)
    wx.removeStorageSync(userKey ? scopedKey(key, userKey) : key)
  } catch (e) {}
}

module.exports = {
  getScoped,
  setScoped,
  removeScoped
}