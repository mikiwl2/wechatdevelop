// app.js
const LEGACY_KEYS = ['userInfo', 'tryonList', 'generateCount', 'profile', 'indexInteractions', 'commentsById']
const CLOUD_ENV_ID = 'cloud1-0g15dqxu9ad791a6'

App({
  globalData: {
    userInfo: null,
    tryonList: [],
    generateCount: 0,
    userKey: '',
    cloudReady: false,
    cloudEnvId: CLOUD_ENV_ID
  },

  onLaunch() {
    try {
      if (wx.cloud) {
        wx.cloud.init({
          env: CLOUD_ENV_ID,
          traceUser: true
        })
        this.globalData.cloudReady = true
      }
    } catch (e) {
      this.globalData.cloudReady = false
    }

    try {
      const activeUserKey = wx.getStorageSync('activeUserKey') || ''
      this.globalData.userKey = activeUserKey
      this.hydrateUserScopedData()
    } catch (e) {}
  },

  _hasStorageKey(key) {
    if (!key) return false
    try {
      const info = wx.getStorageInfoSync()
      const keys = (info && info.keys) || []
      return keys.indexOf(key) !== -1
    } catch (e) {
      return false
    }
  },

  getActiveUserKey() {
    if (this.globalData.userKey) return this.globalData.userKey
    try {
      const key = wx.getStorageSync('activeUserKey') || ''
      this.globalData.userKey = key
      return key
    } catch (e) {
      return this.globalData.userKey || ''
    }
  },

  _scopedKey(baseKey, userKey) {
    return `${baseKey}__${userKey}`
  },

  getScopedStorage(baseKey, fallbackValue) {
    try {
      const userKey = this.getActiveUserKey()
      if (!userKey) return fallbackValue
      const scopedKey = this._scopedKey(baseKey, userKey)
      if (!this._hasStorageKey(scopedKey)) return fallbackValue
      const val = wx.getStorageSync(scopedKey)
      return val === '' && typeof fallbackValue !== 'undefined' ? fallbackValue : val
    } catch (e) {
      return fallbackValue
    }
  },

  setScopedStorage(baseKey, value) {
    try {
      const userKey = this.getActiveUserKey()
      if (!userKey) return
      const scopedKey = this._scopedKey(baseKey, userKey)
      wx.setStorageSync(scopedKey, value)
    } catch (e) {}
  },

  removeScopedStorage(baseKey) {
    try {
      const userKey = this.getActiveUserKey()
      if (!userKey) return
      const scopedKey = this._scopedKey(baseKey, userKey)
      wx.removeStorageSync(scopedKey)
    } catch (e) {}
  },

  _migrateLegacyToScopedIfNeeded(userKey) {
    if (!userKey) return
    const markerKey = `legacyMigrated__${userKey}`
    if (this._hasStorageKey(markerKey)) return

    try {
      LEGACY_KEYS.forEach((baseKey) => {
        const scopedKey = this._scopedKey(baseKey, userKey)
        const hasScoped = this._hasStorageKey(scopedKey)
        const hasLegacy = this._hasStorageKey(baseKey)
        if (!hasScoped && hasLegacy) {
          wx.setStorageSync(scopedKey, wx.getStorageSync(baseKey))
        }
      })

      // 迁移后清理历史全局键，避免后续账号串数据
      LEGACY_KEYS.forEach((baseKey) => {
        if (this._hasStorageKey(baseKey)) wx.removeStorageSync(baseKey)
      })

      wx.setStorageSync(markerKey, true)
    } catch (e) {}
  },

  migrateUserScopedData(fromUserKey, toUserKey) {
    // Disabled intentionally to avoid cross-account data copy.
    // Account data must stay isolated by scoped key.
    return
  },
  setActiveUserKey(userKey) {
    const key = userKey || ''
    this.globalData.userKey = key

    try {
      if (key) {
        wx.setStorageSync('activeUserKey', key)
        this._migrateLegacyToScopedIfNeeded(key)
      } else {
        wx.removeStorageSync('activeUserKey')
      }
    } catch (e) {}

    this.hydrateUserScopedData()
  },

  hydrateUserScopedData() {
    const userInfo = this.getScopedStorage('userInfo', null)
    const tryonList = this.getScopedStorage('tryonList', []) || []
    const generateCount = this.getScopedStorage('generateCount', tryonList.length) || 0
    this.globalData.userInfo = userInfo
    this.globalData.tryonList = tryonList
    this.globalData.generateCount = generateCount
  },

  isLoggedIn() {
    try {
      if (this.globalData.userInfo) return true
      return !!this.getScopedStorage('userInfo', null)
    } catch (e) {
      return !!this.globalData.userInfo
    }
  }
})