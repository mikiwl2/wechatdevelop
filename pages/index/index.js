// index.js - AI wardrobe
const app = getApp()
const STORAGE_INTERACTIONS = 'indexInteractions'
const { requireLoginGate } = require('../../utils/auth-guard')
const { shouldUseMockData } = require('../../utils/mock-config')
const { getScoped, setScoped } = require('../../utils/scoped-storage')

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

function normalizeCloudWork(work) {
  const safe = work || {}
  const owner = safe.owner || {}
  return {
    id: safe.id || safe.workId || '',
    image: safe.image || safe.coverUrl || '',
    avatar: owner.avatarUrl || safe.avatar || '',
    nickname: owner.nickname || safe.nickname || '\u533f\u540d\u7528\u6237',
    likes: Number(safe.likes) || 0,
    saves: Number(safe.saves) || 0,
    comments: Number(safe.comments) || 0,
    title: safe.title || '\u8bd5\u8863\u4f5c\u54c1',
    createdAt: Number(safe.createdAt) || Date.now(),
    published: safe.published === true
  }
}

function buildDisplayList(rawList, interactionMap) {
  const map = interactionMap || {}
  return (rawList || []).map((item) => {
    const key = item && item.id ? item.id : ''
    const ia = (key && map[key]) || {}
    const userLiked = !!ia.liked
    const userSaved = !!ia.saved
    const baseLikes = Math.max(0, Number(item.likes) || 0)
    const baseSaves = Math.max(0, Number(item.saves) || 0)

    return Object.assign({}, item || {}, {
      baseLikes: baseLikes,
      baseSaves: baseSaves,
      userLiked: userLiked,
      userSaved: userSaved,
      likesDisplay: baseLikes,
      savesDisplay: baseSaves
    })
  })
}

Page({
  data: {
    list: []
  },

  _loginRedirecting: false,

  _requireLogin(options) {
    return requireLoginGate(this, options || {})
  },

  onShow() {
    if (!this._requireLogin()) return
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar && tabBar.setSelected) {
      tabBar.setSelected(1)
    }
    this.loadList()
  },

  async loadList() {
    const reqId = Date.now()
    this._loadReqId = reqId

    const useMock = shouldUseMockData()
    const mockList = [
      { id: 'm1', image: '/images/placeholder.png', avatar: '', nickname: '\u7a7f\u642d\u8fbe\u4eba', likes: 12, saves: 5 },
      { id: 'm2', image: '/images/placeholder.png', avatar: '', nickname: '\u65f6\u5c1a\u535a\u4e3b', likes: 28, saves: 10 }
    ]

    let cloudList = []
    try {
      const res = await callCloudWorks('listPublic', { limit: 100, offset: 0 })
      if (this._loadReqId !== reqId) return
      cloudList = ((res && res.list) || []).map((item) => normalizeCloudWork(item))
    } catch (e) {
      const localList = (getScoped(app, 'tryonList', []) || []).filter((item) => item && item.published !== false)
      cloudList = localList.map((item) => ({
        id: item.id,
        image: item.image,
        avatar: item.avatar,
        nickname: item.nickname,
        likes: Number(item.likes) || 0,
        saves: Number(item.saves) || 0,
        comments: Number(item.comments) || Number(item.commentCount) || 0,
        title: item.title || '\u8bd5\u8863\u4f5c\u54c1',
        createdAt: Number(item.createdAt) || Date.now(),
        published: item.published !== false
      }))
    }

    const rawList = cloudList.concat(useMock ? mockList : [])
    const workIds = cloudList.map((item) => item.id).filter(Boolean)

    let interactionMap = {}
    try {
      const socialRes = await callCloudSocial('batchGetInteractions', { workIds: workIds })
      if (this._loadReqId !== reqId) return
      interactionMap = (socialRes && socialRes.map) || {}
      setScoped(app, STORAGE_INTERACTIONS, interactionMap)
    } catch (e) {
      interactionMap = getScoped(app, STORAGE_INTERACTIONS, {}) || {}
    }

    const list = buildDisplayList(rawList, interactionMap)
    this.setData({ list: list })
  },

  _saveLocalInteraction(id, key, value) {
    const interactions = getScoped(app, STORAGE_INTERACTIONS, {}) || {}
    if (!interactions[id]) interactions[id] = {}
    interactions[id][key] = value
    interactions[id].updatedAt = Date.now()
    setScoped(app, STORAGE_INTERACTIONS, interactions)
  },

  _applyToggleResult(index, key, result) {
    const list = this.data.list || []
    const item = list[index]
    if (!item) return

    const interaction = (result && result.interaction) || {}
    const stats = (result && result.stats) || {}

    const nextLiked = key === 'liked' ? !!interaction.liked : !!item.userLiked
    const nextSaved = key === 'saved' ? !!interaction.saved : !!item.userSaved
    const baseLikes = Math.max(0, Number(stats.likes != null ? stats.likes : item.likes) || 0)
    const baseSaves = Math.max(0, Number(stats.saves != null ? stats.saves : item.saves) || 0)

    list[index] = Object.assign({}, item, {
      likes: baseLikes,
      saves: baseSaves,
      baseLikes: baseLikes,
      baseSaves: baseSaves,
      userLiked: nextLiked,
      userSaved: nextSaved,
      likesDisplay: baseLikes,
      savesDisplay: baseSaves
    })

    this.setData({ list: list })

    if (item.id) {
      this._saveLocalInteraction(item.id, 'liked', nextLiked)
      this._saveLocalInteraction(item.id, 'saved', nextSaved)
    }
  },

  _toggleLocalOnly(index, key) {
    const list = this.data.list || []
    const item = list[index]
    if (!item) return

    const nextValue = key === 'liked' ? !item.userLiked : !item.userSaved
    const baseLikes = Math.max(0, Number(item.likes) || 0)
    const baseSaves = Math.max(0, Number(item.saves) || 0)
    const nextLiked = key === 'liked' ? nextValue : !!item.userLiked
    const nextSaved = key === 'saved' ? nextValue : !!item.userSaved

    list[index] = Object.assign({}, item, {
      userLiked: nextLiked,
      userSaved: nextSaved,
      likesDisplay: baseLikes,
      savesDisplay: baseSaves
    })
    this.setData({ list: list })

    if (item.id) {
      this._saveLocalInteraction(item.id, 'liked', nextLiked)
      this._saveLocalInteraction(item.id, 'saved', nextSaved)
    }
  },

  async onLike(e) {
    if (!this._requireLogin()) return
    const index = Number(e.currentTarget.dataset.index)
    const list = this.data.list || []
    const item = list[index]
    if (!item) return

    if (String(item.id || '').indexOf('m') === 0) {
      this._toggleLocalOnly(index, 'liked')
      wx.showToast({ title: list[index].userLiked ? '\u5df2\u70b9\u8d5e' : '\u5df2\u53d6\u6d88', icon: 'none', duration: 800 })
      return
    }

    try {
      const target = !item.userLiked
      const res = await callCloudSocial('toggleLike', { workId: item.id, value: target })
      this._applyToggleResult(index, 'liked', res)
      const next = (res && res.interaction && res.interaction.liked) || false
      wx.showToast({ title: next ? '\u5df2\u70b9\u8d5e' : '\u5df2\u53d6\u6d88', icon: 'none', duration: 800 })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '\u64cd\u4f5c\u5931\u8d25', icon: 'none' })
    }
  },

  async onCollect(e) {
    if (!this._requireLogin()) return
    const index = Number(e.currentTarget.dataset.index)
    const list = this.data.list || []
    const item = list[index]
    if (!item) return

    if (String(item.id || '').indexOf('m') === 0) {
      this._toggleLocalOnly(index, 'saved')
      wx.showToast({ title: list[index].userSaved ? '\u5df2\u6536\u85cf' : '\u5df2\u53d6\u6d88\u6536\u85cf', icon: 'none', duration: 800 })
      return
    }

    try {
      const target = !item.userSaved
      const res = await callCloudSocial('toggleSave', { workId: item.id, value: target })
      this._applyToggleResult(index, 'saved', res)
      const next = (res && res.interaction && res.interaction.saved) || false
      wx.showToast({ title: next ? '\u5df2\u6536\u85cf' : '\u5df2\u53d6\u6d88\u6536\u85cf', icon: 'none', duration: 800 })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '\u64cd\u4f5c\u5931\u8d25', icon: 'none' })
    }
  },

  onAdd() {
    if (!this._requireLogin()) return
    wx.switchTab({ url: '/pages/ai-quick/ai-quick' })
  },

  onOpenDetail(e) {
    if (!this._requireLogin()) return
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/detail/detail/detail?id=${encodeURIComponent(id)}` })
  },

  _saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath: filePath,
      success: () => wx.showToast({ title: '\u5df2\u4fdd\u5b58', icon: 'success' }),
      fail: () => wx.showToast({ title: '\u4fdd\u5b58\u5931\u8d25', icon: 'none' })
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

  onLongPress(e) {
    if (!this._requireLogin()) return
    const item = e.currentTarget.dataset.item
    wx.showActionSheet({
      itemList: ['\u4fdd\u5b58\u5230\u76f8\u518c', '\u5206\u4eab'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this._saveImageBySource(item && item.image)
        } else if (res.tapIndex === 1) {
          wx.showShareMenu({ withShareTicket: true })
          wx.showToast({ title: '\u70b9\u51fb\u53f3\u4e0a\u89d2\u5206\u4eab', icon: 'none' })
        }
      }
    })
  }
})
