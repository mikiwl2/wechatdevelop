// mine.js
const { getScoped, setScoped, removeScoped } = require('../../utils/scoped-storage')

function getAppSafe() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

function callCloudAuth(action, payload) {
  const safePayload = payload || {}
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('\u4e91\u80fd\u529b\u4e0d\u53ef\u7528'))
      return
    }

    wx.cloud.callFunction({
      name: 'auth_v2',
      data: Object.assign({ action: action }, safePayload),
      success: (res) => {
        const result = (res && res.result) || {}
        if (result.ok === false) {
          reject(new Error(result.message || '\u4e91\u51fd\u6570\u8c03\u7528\u5931\u8d25'))
          return
        }
        resolve(result)
      },
      fail: (err) => reject(err)
    })
  })
}

function callCloudWorks(action, payload) {
  const safePayload = payload || {}
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('\u4e91\u80fd\u529b\u4e0d\u53ef\u7528'))
      return
    }

    wx.cloud.callFunction({
      name: 'works_v1',
      data: Object.assign({ action: action }, safePayload),
      success: (res) => {
        const result = (res && res.result) || {}
        if (result.ok === false) {
          reject(new Error(result.message || '\u4f5c\u54c1\u4e91\u51fd\u6570\u8c03\u7528\u5931\u8d25'))
          return
        }
        resolve(result)
      },
      fail: (err) => reject(err)
    })
  })
}

function callCloudSocial(action, payload) {
  const safePayload = payload || {}
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('\u4e91\u80fd\u529b\u4e0d\u53ef\u7528'))
      return
    }

    wx.cloud.callFunction({
      name: 'works_social_v1',
      data: Object.assign({ action: action }, safePayload),
      success: (res) => {
        const result = (res && res.result) || {}
        if (result.ok === false) {
          reject(new Error(result.message || '\u793e\u4ea4\u4e91\u51fd\u6570\u8c03\u7528\u5931\u8d25'))
          return
        }
        resolve(result)
      },
      fail: (err) => reject(err)
    })
  })
}

function normalizeCloudUser(user) {
  const data = user || {}
  return {
    nickName: data.nickname || '\u5fae\u4fe1\u7528\u6237',
    avatarUrl: data.avatarUrl || ''
  }
}

function normalizeCloudWork(work) {
  const safe = work || {}
  const owner = safe.owner || {}
  return {
    id: safe.id || safe.workId || '',
    image: safe.image || safe.coverUrl || '',
    avatar: owner.avatarUrl || safe.avatar || '',
    nickname: owner.nickname || safe.nickname || '\u5fae\u4fe1\u7528\u6237',
    likes: Number(safe.likes) || 0,
    saves: Number(safe.saves) || 0,
    commentCount: Number(safe.comments) || Number(safe.commentCount) || 0,
    createdAt: Number(safe.createdAt) || Date.now(),
    title: safe.title || '\u8bd5\u8863\u4f5c\u54c1',
    published: safe.published === true
  }
}

function uniqueStrings(list) {
  const map = {}
  ;(list || []).forEach((it) => {
    const key = String(it || '').trim()
    if (!key) return
    map[key] = true
  })
  return Object.keys(map)
}

function buildInteractionMapFromList(list) {
  const map = {}
  ;(list || []).forEach((it) => {
    const workId = String(it.workId || '').trim()
    if (!workId) return
    map[workId] = {
      liked: !!it.liked,
      saved: !!it.saved,
      updatedAt: Number(it.updatedAt) || 0
    }
  })
  return map
}

function enrichWorks(baseList, interactionMap) {
  const map = interactionMap || {}
  return (baseList || []).map((item) => {
    const id = item && item.id ? item.id : ''
    const ia = (id && map[id]) || {}
    const userLiked = !!ia.liked
    const userSaved = !!ia.saved
    const baseLikes = Math.max(0, Number(item.likes) || 0)
    const baseSaves = Math.max(0, Number(item.saves) || 0)
    return Object.assign({}, item || {}, {
      id: id,
      commentCount: Number(item.commentCount) || 0,
      userLiked: userLiked,
      userSaved: userSaved,
      baseLikes: baseLikes,
      baseSaves: baseSaves,
      likesDisplay: baseLikes,
      savesDisplay: baseSaves
    })
  })
}

Page({
  data: {
    isLogged: false,
    avatarUrl: '',
    nickname: '',
    tryonCount: 0,
    tryonList: [],
    heroHeight: 280,
    latestTryonImage: '',
    statSaved: 0,
    statGenerated: 0,
    statLikes: 0,
    _statTargets: { saved: 0, generated: 0, likes: 0 },
    likedList: [],
    savedList: [],
    tabIndex: 0,
    indicatorLeft: '16.666%',
    isDeleteMode: false,
    deleteSelected: []
  },

  onLoad() {
    let h = 667
    try {
      const sys = wx.getSystemInfoSync()
      if (sys) h = sys.windowHeight || h
    } catch (e) {}
    this.setData({ heroHeight: Math.floor(h * 0.48) })
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar && tabBar.setSelected) {
      tabBar.setSelected(2)
    }
    this._refreshPageData()
  },

  onHide() {
    this._clearStatTimers()
  },

  onUnload() {
    this._clearStatTimers()
  },

  _clearStatTimers() {
    if (this._statStartTimer) {
      clearTimeout(this._statStartTimer)
      this._statStartTimer = null
    }
    if (this._statStepTimer) {
      clearTimeout(this._statStepTimer)
      this._statStepTimer = null
    }
  },

  _animateStats() {
    const targets = this.data._statTargets
    if (!targets) return

    this._clearStatTimers()
    const step = Math.max(1, Math.ceil(Math.max(targets.saved, targets.generated, targets.likes) / 15))
    const delay = 35
    let saved = 0
    let generated = 0
    let likes = 0

    const run = () => {
      saved = Math.min(saved + step, targets.saved)
      generated = Math.min(generated + step, targets.generated)
      likes = Math.min(likes + step, targets.likes)
      this.setData({ statSaved: saved, statGenerated: generated, statLikes: likes })
      if (saved < targets.saved || generated < targets.generated || likes < targets.likes) {
        this._statStepTimer = setTimeout(run, delay)
      } else {
        this._statStepTimer = null
      }
    }

    this._statStartTimer = setTimeout(() => {
      this._statStartTimer = null
      run()
    }, 80)
  },

  _applyPageData(userInfo, ownList, likedList, savedList, generateCount) {
    const latestImg = ownList.length > 0 ? ownList[0].image : ''

    this.setData({
      isLogged: !!userInfo,
      avatarUrl: (userInfo && userInfo.avatarUrl) || '',
      nickname: (userInfo && userInfo.nickName) || '\u7528\u6237',
      tryonCount: ownList.length,
      tryonList: ownList,
      latestTryonImage: latestImg,
      likedList: likedList,
      savedList: savedList,
      statSaved: 0,
      statGenerated: 0,
      statLikes: 0,
      _statTargets: {
        saved: ownList.length,
        generated: generateCount,
        likes: likedList.length
      }
    })
    this._animateStats()
  },

  async _refreshPageData() {
    const app = getAppSafe()
    const reqId = Date.now()
    this._reqId = reqId

    let userInfo = getScoped(app, 'userInfo', null)
    const profile = getScoped(app, 'profile', {}) || {}

    if (userInfo) {
      userInfo = Object.assign({}, userInfo)
      if (profile.nickname) userInfo.nickName = profile.nickname
      if (profile.avatarUrl) userInfo.avatarUrl = profile.avatarUrl
      if (app && app.globalData) app.globalData.userInfo = userInfo
      setScoped(app, 'userInfo', userInfo)
    }

    if (!userInfo) {
      this._applyPageData(null, [], [], [], 0)
      return
    }

    const cachedWorks = getScoped(app, 'tryonList', []) || []
    const cachedGenerate = Number(getScoped(app, 'generateCount', cachedWorks.length) || 0)
    const cachedInteractions = getScoped(app, 'indexInteractions', {}) || {}
    const cachedOwn = enrichWorks(cachedWorks, cachedInteractions)
    this._applyPageData(userInfo, cachedOwn, cachedOwn.filter((x) => x.userLiked), cachedOwn.filter((x) => x.userSaved), cachedGenerate)

    try {
      const mineRes = await callCloudWorks('listMine', { limit: 100, offset: 0, includeDeleted: false })
      if (this._reqId !== reqId) return
      const ownBaseList = ((mineRes && mineRes.list) || []).map((w) => normalizeCloudWork(w))

      const ownWorkIds = ownBaseList.map((w) => w.id).filter(Boolean)

      let ownInteractionMap = {}
      try {
        const ownInteractionRes = await callCloudSocial('batchGetInteractions', { workIds: ownWorkIds })
        ownInteractionMap = (ownInteractionRes && ownInteractionRes.map) || {}
      } catch (e) {
        ownInteractionMap = cachedInteractions
      }

      let socialList = []
      try {
        const socialRes = await callCloudSocial('listMyInteractions', { type: 'all', limit: 200, offset: 0 })
        socialList = (socialRes && socialRes.list) || []
      } catch (e) {
        socialList = []
      }

      const socialMap = buildInteractionMapFromList(socialList)
      const mergedMap = Object.assign({}, ownInteractionMap || {}, socialMap || {})
      setScoped(app, 'indexInteractions', mergedMap)

      const ownList = enrichWorks(ownBaseList, mergedMap)
      if (app && app.globalData) app.globalData.tryonList = ownList
      setScoped(app, 'tryonList', ownList)

      const likeIds = uniqueStrings((socialList || []).filter((it) => it && it.liked).map((it) => it.workId))
      const saveIds = uniqueStrings((socialList || []).filter((it) => it && it.saved).map((it) => it.workId))
      const unionIds = uniqueStrings(likeIds.concat(saveIds))

      let worksById = {}
      if (unionIds.length > 0) {
        try {
          const byIdRes = await callCloudWorks('listByIds', { workIds: unionIds })
          const list = ((byIdRes && byIdRes.list) || []).map((w) => normalizeCloudWork(w))
          list.forEach((w) => {
            if (!w.id) return
            worksById[w.id] = w
          })
        } catch (e) {
          const fallback = ownBaseList || []
          fallback.forEach((w) => {
            if (!w.id) return
            worksById[w.id] = w
          })
        }
      }

      const likedBase = likeIds.map((id) => worksById[id]).filter(Boolean)
      const savedBase = saveIds.map((id) => worksById[id]).filter(Boolean)

      const likedList = enrichWorks(likedBase, mergedMap)
      const savedList = enrichWorks(savedBase, mergedMap)

      const localGenerateCount = Number(getScoped(app, 'generateCount', 0) || 0)
      const nextGenerateCount = Math.max(localGenerateCount, ownList.length)
      if (app && app.globalData) app.globalData.generateCount = nextGenerateCount
      setScoped(app, 'generateCount', nextGenerateCount)

      this._applyPageData(userInfo, ownList, likedList, savedList, nextGenerateCount)
    } catch (e) {
      // keep cached display
    }
  },

  onLogoutTap() {
    const app = getAppSafe()
    wx.showModal({
      title: '\u9000\u51fa\u767b\u5f55',
      content: '\u786e\u5b9a\u9000\u51fa\u5f53\u524d\u8d26\u53f7\u5417\uff1f',
      success: (res) => {
        if (!res.confirm || !app) return

        this._clearStatTimers()
        app.globalData.userInfo = null
        app.globalData.tryonList = []
        app.globalData.generateCount = 0
        removeScoped(app, 'userInfo')
        if (typeof app.setActiveUserKey === 'function') app.setActiveUserKey('')
        try {
          wx.removeStorageSync('userInfo')
        } catch (e) {}

        this.setData({
          isLogged: false,
          avatarUrl: '',
          nickname: '',
          tryonCount: 0,
          tryonList: [],
          latestTryonImage: '',
          likedList: [],
          savedList: [],
          statSaved: 0,
          statGenerated: 0,
          statLikes: 0,
          _statTargets: { saved: 0, generated: 0, likes: 0 },
          tabIndex: 0,
          indicatorLeft: '16.666%',
          isDeleteMode: false,
          deleteSelected: []
        })
        wx.showToast({ title: '\u5df2\u9000\u51fa\u767b\u5f55', icon: 'success' })
      }
    })
  },

  onGoProfile() {
    wx.navigateTo({ url: '/pages/edit-profile/edit-profile' })
  },

  onMoreTap() {
    wx.showActionSheet({
      itemList: ['\u4e2a\u4eba\u8d44\u6599'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/pages/edit-profile/edit-profile' })
        }
      }
    })
  },

  onAvatarTap() {
    this.onMoreTap()
  },

  onPreviewImage(e) {
    const index = e.currentTarget.dataset.index
    const urls = (this.data.tryonList || []).map((item) => item.image).filter(Boolean)
    if (urls.length > 0 && urls[index]) {
      wx.previewImage({ current: urls[index], urls: urls })
    }
  },

  _saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath: filePath,
      success: () => wx.showToast({ title: '\u5df2\u4fdd\u5b58', icon: 'success' }),
      fail: (err) => wx.showToast({ title: (err && err.errMsg) || '\u4fdd\u5b58\u5931\u8d25', icon: 'none' })
    })
  },

  _saveImageBySource(imagePath) {
    if (!imagePath) {
      wx.showToast({ title: '\u56fe\u7247\u4e0d\u5b58\u5728', icon: 'none' })
      return
    }

    if (String(imagePath).indexOf('cloud://') === 0 && wx.cloud && typeof wx.cloud.downloadFile === 'function') {
      wx.cloud.downloadFile({
        fileID: imagePath,
        success: (res) => {
          if (res && res.tempFilePath) {
            this._saveToAlbum(res.tempFilePath)
            return
          }
          wx.showToast({ title: '\u4e0b\u8f7d\u5931\u8d25', icon: 'none' })
        },
        fail: () => wx.showToast({ title: '\u4e0b\u8f7d\u5931\u8d25', icon: 'none' })
      })
      return
    }

    if (/^https?:\/\//i.test(imagePath)) {
      wx.downloadFile({
        url: imagePath,
        success: (r) => {
          if (r.statusCode === 200 && r.tempFilePath) {
            this._saveToAlbum(r.tempFilePath)
            return
          }
          wx.showToast({ title: '\u4e0b\u8f7d\u5931\u8d25', icon: 'none' })
        },
        fail: () => wx.showToast({ title: '\u4e0b\u8f7d\u5931\u8d25', icon: 'none' })
      })
      return
    }

    this._saveToAlbum(imagePath)
  },

  _persistTryonList(list) {
    const app = getAppSafe()
    const nextList = Array.isArray(list) ? list : []
    if (app && app.globalData) app.globalData.tryonList = nextList
    setScoped(app, 'tryonList', nextList)
  },

  async _deleteWorksByIds(workIds) {
    const ids = (workIds || []).map((id) => String(id || '')).filter(Boolean)
    if (!ids.length) return { totalDeleted: 0, cloudDeleted: 0, localDeleted: 0 }

    const cloudIds = []
    const localLegacyIds = []
    ids.forEach((id) => {
      if (id.indexOf('u_legacy_') === 0) {
        localLegacyIds.push(id)
      } else {
        cloudIds.push(id)
      }
    })

    let cloudDeleted = 0
    for (let i = 0; i < cloudIds.length; i += 1) {
      try {
        await callCloudWorks('deleteWork', {
          workId: cloudIds[i],
          hardDelete: true,
          purgeFiles: true
        })
        cloudDeleted += 1
      } catch (e) {}
    }

    let localDeleted = 0
    if (localLegacyIds.length > 0) {
      const before = this.data.tryonList || []
      const keepList = before.filter((item) => !localLegacyIds.includes(String(item && item.id)))
      localDeleted = before.length - keepList.length
      this._persistTryonList(keepList)
    }

    return {
      totalDeleted: cloudDeleted + localDeleted,
      cloudDeleted: cloudDeleted,
      localDeleted: localDeleted
    }
  },

  onWorkLongPress(e) {
    if (this.data.isDeleteMode) return
    const index = Number(e.currentTarget.dataset.index)
    const target = (this.data.tryonList || [])[index]
    if (!target) return

    wx.showActionSheet({
      itemList: ['\u4fdd\u5b58\u5230\u76f8\u518c', '\u5206\u4eab', '\u5220\u9664'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this._saveImageBySource(target.image)
          return
        }

        if (res.tapIndex === 1) {
          wx.showShareMenu({ withShareTicket: true })
          wx.showToast({ title: '\u8bf7\u70b9\u51fb\u53f3\u4e0a\u89d2\u8fdb\u884c\u5206\u4eab', icon: 'none' })
          return
        }

        if (res.tapIndex === 2) {
          wx.showModal({
            title: '\u5220\u9664\u4f5c\u54c1',
            content: '\u786e\u8ba4\u5220\u9664\u8fd9\u6761\u8bd5\u8863\u4f5c\u54c1\u5417\uff1f',
            success: async (r) => {
              if (!r.confirm) return
              wx.showLoading({ title: '\u5220\u9664\u4e2d' })
              const deleted = await this._deleteWorksByIds([target.id])
              wx.hideLoading()

              if (deleted.totalDeleted > 0) {
                this._refreshPageData()
                wx.showToast({ title: '\u5df2\u5220\u9664', icon: 'success' })
              } else {
                wx.showToast({ title: '\u5220\u9664\u5931\u8d25', icon: 'none' })
              }
            }
          })
        }
      }
    })
  },

  onGoTryon() {
    wx.switchTab({ url: '/pages/ai-quick/ai-quick' })
  },

  onEnterDeleteMode() {
    this.setData({ isDeleteMode: true, deleteSelected: [] })
  },

  onExitDeleteMode() {
    this.setData({ isDeleteMode: false, deleteSelected: [] })
  },

  onToggleDeleteSelect(e) {
    const index = e.currentTarget.dataset.index
    if (index == null) return
    const idx = Number(index)
    const selected = this.data.deleteSelected || []
    const i = selected.indexOf(idx)
    const next = i === -1 ? selected.concat([idx]) : selected.filter((_, j) => j !== i)
    this.setData({ deleteSelected: next })
  },

  async onConfirmDelete() {
    const deleteSelected = this.data.deleteSelected || []
    const tryonList = this.data.tryonList || []

    if (deleteSelected.length === 0) {
      wx.showToast({ title: '\u8bf7\u5148\u9009\u62e9\u4f5c\u54c1', icon: 'none' })
      return
    }

    const ids = deleteSelected
      .map((idx) => tryonList[idx])
      .filter(Boolean)
      .map((item) => item.id)
      .filter(Boolean)

    if (!ids.length) {
      wx.showToast({ title: '\u9009\u4e2d\u6570\u636e\u65e0\u6548', icon: 'none' })
      return
    }

    wx.showLoading({ title: '\u5220\u9664\u4e2d' })
    const deleted = await this._deleteWorksByIds(ids)
    wx.hideLoading()

    if (deleted.totalDeleted > 0) {
      this.setData({ isDeleteMode: false, deleteSelected: [] })
      this._refreshPageData()
      wx.showToast({ title: `\u5df2\u5220\u9664 ${deleted.totalDeleted} \u9879`, icon: 'success' })
    } else {
      wx.showToast({ title: '\u5220\u9664\u5931\u8d25', icon: 'none' })
    }
  },

  _setTab(index) {
    const i = Math.max(0, Math.min(2, Number(index) || 0))
    const left = (i * 33.333 + 16.666).toFixed(3) + '%'
    this.setData({ tabIndex: i, indicatorLeft: left })
  },

  onTabTap(e) {
    const index = e.currentTarget.dataset.index
    if (this.data.isDeleteMode) {
      this.setData({ isDeleteMode: false, deleteSelected: [] })
    }
    this._setTab(index)
  },

  onOpenDetail(e) {
    if (this.data.isDeleteMode) return
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/detail/detail/detail?id=${encodeURIComponent(id)}` })
  },

  onWorkItemTap(e) {
    if (this.data.isDeleteMode) {
      this.onToggleDeleteSelect(e)
    } else {
      this.onOpenDetail(e)
    }
  },

  onLogin() {
    if (this._loginInFlight) {
      wx.showToast({ title: '\u8bf7\u7a0d\u5019', icon: 'none' })
      return
    }
    this._loginInFlight = true

    const app = getAppSafe()
    const unlockLogin = () => {
      this._loginInFlight = false
    }

    const activateUserKey = (nextKey) => {
      const key = String(nextKey || '')
      if (app && typeof app.setActiveUserKey === 'function') {
        app.setActiveUserKey(key)
      }
      return key
    }

    const readProfile = () => getScoped(app, 'profile', {}) || {}
    const writeProfile = (profileData) => {
      setScoped(app, 'profile', profileData || {})
    }

    const applyProfile = (userData) => {
      const profileData = readProfile()
      const merged = Object.assign({}, userData || {})
      if (!merged.nickName && profileData.nickname) merged.nickName = profileData.nickname
      if (!merged.avatarUrl && profileData.avatarUrl) merged.avatarUrl = profileData.avatarUrl
      if (app) app.globalData.userInfo = merged
      setScoped(app, 'userInfo', merged)
      if (app && typeof app.hydrateUserScopedData === 'function') {
        app.hydrateUserScopedData()
      }
      this.setData({
        isLogged: true,
        nickname: merged.nickName || '\u7528\u6237',
        avatarUrl: merged.avatarUrl || ''
      })
      this._refreshPageData()
    }

    const completeLogin = (cloudUser, profileOverride) => {
      const profileData = profileOverride || readProfile()
      const normalized = normalizeCloudUser(cloudUser)
      if (profileData.nickname) normalized.nickName = profileData.nickname
      if (profileData.avatarUrl) normalized.avatarUrl = profileData.avatarUrl
      applyProfile(normalized)
      wx.showToast({ title: '\u767b\u5f55\u6210\u529f', icon: 'success' })
    }

    const syncProfileFromCloud = (loginRes) => {
      return callCloudAuth('getProfile')
        .then((profileRes) => {
          const cloudProfile = (profileRes && profileRes.profile) || {}
          const cloudUser = (profileRes && profileRes.user) || loginRes.user || {}
          const localProfile = readProfile()
          const nextProfile = Object.assign({}, localProfile || {}, cloudProfile || {}, {
            nickname: cloudProfile.nickname || cloudUser.nickname || localProfile.nickname || '',
            avatarUrl: cloudProfile.avatarUrl || cloudUser.avatarUrl || localProfile.avatarUrl || ''
          })
          writeProfile(nextProfile)
          completeLogin(cloudUser, nextProfile)
        })
        .catch(() => {
          completeLogin(loginRes.user, readProfile())
        })
    }

    callCloudAuth('login')
      .then((loginRes) => {
        const userKey = String(loginRes.userKey || loginRes.openid || '')
        if (!userKey) throw new Error('\u4e91\u7aef\u7528\u6237\u6807\u8bc6\u7f3a\u5931')

        activateUserKey(userKey)
        return syncProfileFromCloud(loginRes)
      })
      .then(() => {
        unlockLogin()
      })
      .catch((err) => {
        unlockLogin()
        const message = (err && err.message) || '\u4e91\u7aef\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u5148\u90e8\u7f72 auth_v2'
        wx.showModal({
          title: '\u767b\u5f55\u5931\u8d25',
          content: message,
          showCancel: false
        })
      })
  }
})
