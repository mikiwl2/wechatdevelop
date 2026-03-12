// detail.js
function getAppSafe() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

const { requireLoginGate } = require('../../../utils/auth-guard')
const { shouldUseMockData } = require('../../../utils/mock-config')

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

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function ensureMockComments(id) {
  if (id === 'm1') {
    return [
      { id: 'c1', nickname: '\u5c0f\u6674', avatar: '', text: '\u8fd9\u4e2a\u914d\u8272\u597d\u770b\uff01', createdAt: Date.now() - 3600 * 1000 },
      { id: 'c2', nickname: '\u963f\u6770', avatar: '', text: '\u6c42\u540c\u6b3e\u8863\u670d\u94fe\u63a5', createdAt: Date.now() - 7200 * 1000 }
    ]
  }
  if (id === 'm2') {
    return [{ id: 'c3', nickname: '\u53ef\u4e50', avatar: '', text: '\u5f88\u9177\uff0c\u70b9\u8d5e\uff01', createdAt: Date.now() - 5400 * 1000 }]
  }
  return []
}

function normalizeComment(comment) {
  const c = comment || {}
  return {
    id: c.id || c._id || '',
    nickname: c.nickname || '\u533f\u540d',
    avatar: c.avatarUrl || c.avatar || '',
    text: c.content || c.text || '',
    createdAt: Number(c.createdAt) || Date.now(),
    timeText: fmtTime(c.createdAt)
  }
}

Page({
  data: {
    id: '',
    item: {},
    userLiked: false,
    userSaved: false,
    likes: 0,
    saves: 0,
    createdAtText: '',
    comments: [],
    draft: '',
    itemMissing: false
  },

  _loginRedirecting: false,

  _requireLogin(options) {
    return requireLoginGate(this, options || {})
  },

  async onLoad(options) {
    const id = (options && options.id) || ''
    this.setData({ id: id })
    if (!this._requireLogin({ toast: false })) return

    const loaded = await this._loadItem(id)
    if (!loaded) return
    await this._loadSocialState(id)
  },

  async onShow() {
    if (!this._requireLogin()) return
    const id = this.data.id
    if (!id) return

    await this._loadItem(id)
    if (this.data.itemMissing) return
    await this._loadSocialState(id)
  },

  async _loadItem(id) {
    if (!id) {
      this.setData({ itemMissing: true })
      return false
    }

    try {
      const res = await callCloudWorks('getWork', { workId: id })
      const item = normalizeCloudWork((res && res.work) || {})
      this.setData({
        item: item,
        createdAtText: fmtTime(item.createdAt) || '\u521a\u521a',
        itemMissing: false,
        likes: Math.max(0, Number(item.likes) || 0),
        saves: Math.max(0, Number(item.saves) || 0)
      })
      return true
    } catch (e) {
      this.setData({
        item: { id: id, image: '/images/placeholder.png', likes: 0, saves: 0, title: '\u4f5c\u54c1\u4e0d\u5b58\u5728' },
        createdAtText: '',
        itemMissing: true,
        comments: [],
        userLiked: false,
        userSaved: false,
        likes: 0,
        saves: 0
      })
      wx.showToast({ title: '\u4f5c\u54c1\u4e0d\u5b58\u5728\u6216\u5df2\u5220\u9664', icon: 'none' })
      return false
    }
  },

  async _loadSocialState(id) {
    const isMock = String(id || '').indexOf('m') === 0

    if (isMock) {
      const fallback = shouldUseMockData() ? ensureMockComments(id) : []
      const comments = fallback.map((c) => normalizeComment(c))
      this.setData({
        userLiked: false,
        userSaved: false,
        comments: comments
      })
      return
    }

    try {
      const interactionRes = await callCloudSocial('getInteraction', { workId: id })
      const interaction = (interactionRes && interactionRes.interaction) || {}
      const stats = (interactionRes && interactionRes.stats) || {}

      this.setData({
        userLiked: !!interaction.liked,
        userSaved: !!interaction.saved,
        likes: Math.max(0, Number(stats.likes != null ? stats.likes : this.data.likes) || 0),
        saves: Math.max(0, Number(stats.saves != null ? stats.saves : this.data.saves) || 0)
      })

      const commentsRes = await callCloudSocial('listComments', { workId: id, limit: 100, offset: 0 })
      const list = ((commentsRes && commentsRes.list) || []).map((it) => normalizeComment(it))
      this.setData({ comments: list })
    } catch (e) {
      const fallback = shouldUseMockData() ? ensureMockComments(id) : []
      this.setData({ comments: fallback.map((c) => normalizeComment(c)) })
    }
  },

  async onToggleLike() {
    if (!this._requireLogin()) return
    if (this.data.itemMissing) return

    const id = this.data.id
    if (String(id || '').indexOf('m') === 0) {
      const next = !this.data.userLiked
      const baseLikes = Math.max(0, Number(this.data.item.likes) || 0)
      this.setData({ userLiked: next, likes: baseLikes + (next ? 1 : 0) })
      return
    }

    try {
      const res = await callCloudSocial('toggleLike', {
        workId: id,
        value: !this.data.userLiked
      })
      const interaction = (res && res.interaction) || {}
      const stats = (res && res.stats) || {}
      this.setData({
        userLiked: !!interaction.liked,
        userSaved: !!interaction.saved,
        likes: Math.max(0, Number(stats.likes) || 0),
        saves: Math.max(0, Number(stats.saves) || 0)
      })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '\u64cd\u4f5c\u5931\u8d25', icon: 'none' })
    }
  },

  async onToggleSave() {
    if (!this._requireLogin()) return
    if (this.data.itemMissing) return

    const id = this.data.id
    if (String(id || '').indexOf('m') === 0) {
      const next = !this.data.userSaved
      const baseSaves = Math.max(0, Number(this.data.item.saves) || 0)
      this.setData({ userSaved: next, saves: baseSaves + (next ? 1 : 0) })
      return
    }

    try {
      const res = await callCloudSocial('toggleSave', {
        workId: id,
        value: !this.data.userSaved
      })
      const interaction = (res && res.interaction) || {}
      const stats = (res && res.stats) || {}
      this.setData({
        userLiked: !!interaction.liked,
        userSaved: !!interaction.saved,
        likes: Math.max(0, Number(stats.likes) || 0),
        saves: Math.max(0, Number(stats.saves) || 0)
      })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '\u64cd\u4f5c\u5931\u8d25', icon: 'none' })
    }
  },

  onDraft(e) {
    this.setData({ draft: e.detail.value })
  },

  async onSend() {
    if (!this._requireLogin()) return
    if (this.data.itemMissing) return

    const text = String(this.data.draft || '').trim()
    if (!text) {
      wx.showToast({ title: '\u8bf7\u8f93\u5165\u8bc4\u8bba', icon: 'none' })
      return
    }

    const id = this.data.id
    if (String(id || '').indexOf('m') === 0) {
      const app = getAppSafe()
      const userInfo = (app && app.globalData && app.globalData.userInfo) || {}
      const item = {
        id: `c_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        nickname: userInfo.nickName || '\u6e38\u5ba2',
        avatar: userInfo.avatarUrl || '',
        text: text,
        createdAt: Date.now()
      }
      const next = [normalizeComment(item)].concat(this.data.comments || [])
      this.setData({ comments: next, draft: '' })
      wx.showToast({ title: '\u5df2\u53d1\u5e03', icon: 'success' })
      return
    }

    try {
      const res = await callCloudSocial('addComment', {
        workId: id,
        content: text
      })
      const comment = normalizeComment((res && res.comment) || {})
      const stats = (res && res.stats) || {}
      const nextComments = [comment].concat(this.data.comments || [])
      this.setData({
        comments: nextComments,
        draft: '',
        likes: Math.max(0, Number(stats.likes != null ? stats.likes : this.data.likes) || 0),
        saves: Math.max(0, Number(stats.saves != null ? stats.saves : this.data.saves) || 0)
      })
      wx.showToast({ title: '\u5df2\u53d1\u5e03', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '\u53d1\u5e03\u5931\u8d25', icon: 'none' })
    }
  },

  onPreview() {
    if (!this._requireLogin()) return
    if (this.data.itemMissing) return
    const img = this.data.item && this.data.item.image
    if (!img) return

    if (String(img).indexOf('cloud://') === 0 && wx.cloud && typeof wx.cloud.downloadFile === 'function') {
      wx.cloud.downloadFile({
        fileID: img,
        success: (res) => {
          if (res && res.tempFilePath) {
            wx.previewImage({ urls: [res.tempFilePath] })
            return
          }
          wx.showToast({ title: '\u9884\u89c8\u5931\u8d25', icon: 'none' })
        },
        fail: () => wx.showToast({ title: '\u9884\u89c8\u5931\u8d25', icon: 'none' })
      })
      return
    }

    wx.previewImage({ urls: [img] })
  }
})
