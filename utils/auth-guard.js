function getAppSafe() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

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

function readScopedUserInfoFallback(app) {
  try {
    const activeKey =
      (app && typeof app.getActiveUserKey === 'function' ? app.getActiveUserKey() : '') ||
      wx.getStorageSync('activeUserKey') ||
      ''
    if (!activeKey) return null
    const scopedKey = `userInfo__${activeKey}`
    if (!hasStorageKey(scopedKey)) return null
    return wx.getStorageSync(scopedKey) || null
  } catch (e) {
    return null
  }
}

function isLoggedIn() {
  const app = getAppSafe()
  if (app && typeof app.isLoggedIn === 'function') return app.isLoggedIn()

  try {
    if (app && app.globalData && app.globalData.userInfo) return true
    if (app && typeof app.getScopedStorage === 'function') {
      return !!app.getScopedStorage('userInfo', null)
    }
    if (readScopedUserInfoFallback(app)) return true
    return false
  } catch (e) {
    return false
  }
}

function requireLoginGate(ctx, options = {}) {
  const {
    redirectTab = '/pages/mine/mine',
    tabIndex = 2,
    toast = true,
    toastText = '\u8BF7\u5148\u767B\u5F55'
  } = options

  if (isLoggedIn()) {
    if (ctx) ctx._loginRedirecting = false
    return true
  }

  if (ctx && ctx._loginRedirecting) return false
  if (ctx) ctx._loginRedirecting = true

  const tabBar = ctx && ctx.getTabBar && ctx.getTabBar()
  if (tabBar && tabBar.setSelected) tabBar.setSelected(tabIndex)

  wx.switchTab({ url: redirectTab })
  if (toast) wx.showToast({ title: toastText, icon: 'none' })
  return false
}

module.exports = {
  isLoggedIn,
  requireLoginGate
}