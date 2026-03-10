// ai-quick.js
const app = getApp()
const { requireLoginGate } = require('../../utils/auth-guard')
const { getScoped, setScoped } = require('../../utils/scoped-storage')

function callCloudWorks(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('\u4e91\u80fd\u529b\u4e0d\u53ef\u7528'))
      return
    }

    wx.cloud.callFunction({
      name: 'works_v1',
      data: Object.assign({ action: action }, payload || {}),
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

function uploadFileToCloud(cloudPath, filePath) {
  return new Promise((resolve, reject) => {
    if (!filePath) {
      resolve({ fileID: '' })
      return
    }

    if (String(filePath).indexOf('cloud://') === 0) {
      resolve({ fileID: filePath })
      return
    }

    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      reject(new Error('\u4e91\u4e0a\u4f20\u80fd\u529b\u4e0d\u53ef\u7528'))
      return
    }

    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => resolve(res),
      fail: (err) => reject(err)
    })
  })
}

function getFileExt(tempFilePath, fallback = 'jpg') {
  const ext = String(tempFilePath || '')
    .split('.')
    .pop()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)
  if (ext) return ext
  return fallback
}

function normalizeCloudWork(work = {}) {
  return {
    id: work.id || work.workId || '',
    image: work.image || work.coverUrl || '',
    avatar: (work.owner && work.owner.avatarUrl) || work.avatar || '',
    nickname: (work.owner && work.owner.nickname) || work.nickname || '\u5fae\u4fe1\u7528\u6237',
    likes: Number(work.likes) || 0,
    saves: Number(work.saves) || 0,
    commentCount: Number(work.comments) || 0,
    createdAt: Number(work.createdAt) || Date.now(),
    title: work.title || '\u8bd5\u8863\u4f5c\u54c1',
    published: work.published === true
  }
}

Page({
  data: {
    personImage: '',
    clothesImage: '',
    showPopup: false,
    generating: false,
    resultImage: ''
  },

  _loginRedirecting: false,

  _requireLogin(options = {}) {
    return requireLoginGate(this, options)
  },

  onShow() {
    if (!this._requireLogin()) return
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar && tabBar.setSelected) {
      tabBar.setSelected(0)
    }
  },

  choosePersonImage() {
    if (!this._requireLogin()) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ personImage: res.tempFiles[0].tempFilePath })
      }
    })
  },

  chooseClothesImage() {
    if (!this._requireLogin()) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ clothesImage: res.tempFiles[0].tempFilePath })
      }
    })
  },

  onGenerate() {
    if (!this._requireLogin()) return
    const { personImage, clothesImage } = this.data
    if (!personImage || !clothesImage) {
      wx.showToast({ title: '\u8bf7\u5148\u4e0a\u4f20\u4eba\u50cf\u548c\u8863\u670d\u56fe', icon: 'none' })
      return
    }

    this.setData({ showPopup: true, generating: true, resultImage: '' })
    setTimeout(() => {
      this.setData({
        generating: false,
        // TODO: replace with real AI result URL
        resultImage: personImage
      })
    }, 2000)
  },

  onClosePopup() {
    this.setData({ showPopup: false })
  },

  async _saveResult(published) {
    const { resultImage, personImage, clothesImage } = this.data
    if (!resultImage) return false

    const userKey = (app && typeof app.getActiveUserKey === 'function' && app.getActiveUserKey()) || ''
    if (!userKey) {
      wx.showToast({ title: '\u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548', icon: 'none' })
      return false
    }

    const workId = `w_${Date.now()}_${Math.floor(Math.random() * 100000)}`
    this.setData({ generating: true })

    try {
      const personFileId = (
        await uploadFileToCloud(`works/${userKey}/${workId}/person.${getFileExt(personImage, 'jpg')}`, personImage)
      ).fileID
      const clothesFileId = (
        await uploadFileToCloud(`works/${userKey}/${workId}/clothes.${getFileExt(clothesImage, 'jpg')}`, clothesImage)
      ).fileID
      const resultFileId = (
        await uploadFileToCloud(`works/${userKey}/${workId}/result.${getFileExt(resultImage, 'jpg')}`, resultImage)
      ).fileID

      const saveRes = await callCloudWorks('createWork', {
        workId,
        title: '\u8bd5\u8863\u4f5c\u54c1',
        published: !!published,
        personFileId,
        clothesFileId,
        resultFileId,
        personUrl: personFileId,
        clothesUrl: clothesFileId,
        resultUrl: resultFileId,
        source: 'ai_quick'
      })

      const savedWork = normalizeCloudWork((saveRes && saveRes.work) || {})
      const list = getScoped(app, 'tryonList', []) || []
      const index = list.findIndex((it) => it && it.id === savedWork.id)
      if (index >= 0) {
        list[index] = Object.assign({}, list[index] || {}, savedWork || {})
      } else {
        list.unshift(savedWork)
      }

      if (app && app.globalData) {
        app.globalData.tryonList = list
      }
      setScoped(app, 'tryonList', list)

      const nextGenerateCount = Number(getScoped(app, 'generateCount', 0) || 0) + 1
      if (app && app.globalData) {
        app.globalData.generateCount = nextGenerateCount
      }
      setScoped(app, 'generateCount', nextGenerateCount)

      this.setData({
        showPopup: false,
        generating: false,
        resultImage: '',
        personImage: '',
        clothesImage: ''
      })
      wx.switchTab({ url: '/pages/mine/mine' })
      return true
    } catch (e) {
      this.setData({ generating: false })
      wx.showToast({ title: (e && e.message) || '\u4fdd\u5b58\u5931\u8d25', icon: 'none' })
      return false
    }
  },

  async onPublishAndSave() {
    if (!this._requireLogin()) return
    const ok = await this._saveResult(true)
    if (ok) {
      wx.showToast({ title: '\u5df2\u53d1\u5e03\u5e76\u4fdd\u5b58', icon: 'success' })
    }
  },

  async onSaveOnly() {
    if (!this._requireLogin()) return
    const ok = await this._saveResult(false)
    if (ok) {
      wx.showToast({ title: '\u5df2\u4fdd\u5b58\u5230\u6211\u7684\u8bd5\u8863', icon: 'success' })
    }
  },

  onDiscard() {
    this.setData({
      showPopup: false,
      resultImage: '',
      personImage: '',
      clothesImage: ''
    })
    wx.showToast({ title: '\u5df2\u53d6\u6d88', icon: 'none', duration: 1000 })
  }
})