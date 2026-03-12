// ai-quick.js
const app = getApp()
const { requireLoginGate } = require('../../utils/auth-guard')
const { getScoped, setScoped } = require('../../utils/scoped-storage')

const CLOTHES_TYPE_OPTIONS = [
  { label: '\u4e0a\u8863', value: 'Upper-body' },
  { label: '\u4e0b\u88c5', value: 'Lower-body' },
  { label: '\u8fde\u8863\u88d9', value: 'Dress' }
]

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

function callCloudTryon(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('\u4e91\u80fd\u529b\u4e0d\u53ef\u7528'))
      return
    }

    wx.cloud.callFunction({
      name: 'ai_tryon_v1',
      data: Object.assign({ action: action }, payload || {}),
      success: (res) => {
        const result = (res && res.result) || {}
        if (result.ok === false) {
          reject(new Error(result.message || 'AI\u8bd5\u8863\u4e91\u51fd\u6570\u8c03\u7528\u5931\u8d25'))
          return
        }
        resolve(result)
      },
      fail: (err) => reject(err)
    })
  })
}

function downloadHttpFile(url) {
  return new Promise((resolve, reject) => {
    if (!url || !/^https?:\/\//i.test(String(url))) {
      reject(new Error('\u4e0b\u8f7d\u5730\u5740\u65e0\u6548'))
      return
    }

    wx.downloadFile({
      url: String(url),
      success: (res) => {
        if (res && res.statusCode === 200 && res.tempFilePath) {
          resolve(res.tempFilePath)
          return
        }
        reject(new Error('\u4e0b\u8f7d\u56fe\u7247\u5931\u8d25'))
      },
      fail: (err) => reject(err)
    })
  })
}

function getTempFileUrl(fileId) {
  return new Promise((resolve, reject) => {
    if (!fileId) {
      reject(new Error('fileId \u4e3a\u7a7a'))
      return
    }

    if (!wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
      reject(new Error('\u4e91\u4e34\u65f6\u94fe\u63a5\u80fd\u529b\u4e0d\u53ef\u7528'))
      return
    }

    wx.cloud.getTempFileURL({
      fileList: [fileId],
      success: (res) => {
        const list = (res && res.fileList) || []
        const first = list[0] || {}
        const url = first.tempFileURL || ''
        if (!url) {
          reject(new Error('\u83b7\u53d6\u4e34\u65f6\u94fe\u63a5\u5931\u8d25'))
          return
        }
        resolve(url)
      },
      fail: (err) => reject(err)
    })
  })
}

async function uploadFileToCloud(cloudPath, filePath) {
  if (!filePath) {
    return { fileID: '' }
  }

  const source = String(filePath)
  if (source.indexOf('cloud://') === 0) {
    return { fileID: source }
  }

  if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
    throw new Error('\u4e91\u4e0a\u4f20\u80fd\u529b\u4e0d\u53ef\u7528')
  }

  let uploadPath = source
  if (/^https?:\/\//i.test(source)) {
    uploadPath = await downloadHttpFile(source)
  }

  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath: uploadPath,
      success: (res) => resolve(res),
      fail: (err) => reject(err)
    })
  })
}

function getFileExt(input, fallback = 'jpg') {
  const clean = String(input || '').split('?')[0].split('#')[0]
  const ext = clean
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
    personSourceFileId: '',
    clothesSourceFileId: '',
    resultSourceFileId: '',
    clothesType: 'Upper-body',
    clothesTypeOptions: CLOTHES_TYPE_OPTIONS,
    showPopup: false,
    generating: false,
    resultImage: '',
    lastAiRequestId: ''
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

  onSelectClothesType(e) {
    if (!this._requireLogin()) return
    const value = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) || '')
    if (!value) return
    this.setData({ clothesType: value })
  },

  async onGenerate() {
    if (!this._requireLogin()) return
    if (this.data.generating) return

    const { personImage, clothesImage, clothesType } = this.data
    if (!personImage || !clothesImage) {
      wx.showToast({ title: '\u8bf7\u5148\u4e0a\u4f20\u6a21\u7279\u56fe\u548c\u670d\u88c5\u56fe', icon: 'none' })
      return
    }

    if (!clothesType) {
      wx.showToast({ title: '\u8bf7\u9009\u62e9\u670d\u88c5\u7c7b\u578b', icon: 'none' })
      return
    }

    const userKey = (app && typeof app.getActiveUserKey === 'function' && app.getActiveUserKey()) || ''
    if (!userKey) {
      wx.showToast({ title: '\u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548', icon: 'none' })
      return
    }

    const taskId = `g_${Date.now()}_${Math.floor(Math.random() * 100000)}`
    this.setData({
      showPopup: true,
      generating: true,
      resultImage: '',
      lastAiRequestId: '',
      personSourceFileId: '',
      clothesSourceFileId: '',
      resultSourceFileId: ''
    })

    try {
      const personFileId = (
        await uploadFileToCloud(`works/${userKey}/${taskId}/person_src.${getFileExt(personImage, 'jpg')}`, personImage)
      ).fileID
      const clothesFileId = (
        await uploadFileToCloud(`works/${userKey}/${taskId}/clothes_src.${getFileExt(clothesImage, 'jpg')}`, clothesImage)
      ).fileID

      const modelUrl = await getTempFileUrl(personFileId)
      const clothUrl = await getTempFileUrl(clothesFileId)

      const aiRes = await callCloudTryon('changeClothes', {
        modelUrl,
        clothesUrl: clothUrl,
        clothesType,
        rspImgType: 'url',
        logoAdd: 1
      })

      const resultImageUrl = String((aiRes && aiRes.resultImage) || '').trim()
      if (!resultImageUrl) {
        throw new Error('AI\u63a5\u53e3\u672a\u8fd4\u56de\u7ed3\u679c\u56fe')
      }

      const transferRes = await callCloudTryon('saveResultToCloud', {
        imageUrl: resultImageUrl,
        cloudPath: `works/${userKey}/${taskId}/result.${getFileExt(resultImageUrl, 'jpg')}`
      })
      const resultSourceFileId = String((transferRes && transferRes.fileId) || '').trim()
      if (!resultSourceFileId) {
        throw new Error('\u7ed3\u679c\u56fe\u8f6c\u5b58\u4e91\u7aef\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5')
      }

      this.setData({
        generating: false,
        resultImage: resultSourceFileId,
        personSourceFileId: personFileId,
        clothesSourceFileId: clothesFileId,
        resultSourceFileId: resultSourceFileId,
        lastAiRequestId: (aiRes && aiRes.requestId) || ''
      })
    } catch (e) {
      this.setData({ generating: false, showPopup: false })
      wx.showToast({ title: (e && e.message) || 'AI\u8bd5\u8863\u751f\u6210\u5931\u8d25', icon: 'none', duration: 2500 })
    }
  },

  onClosePopup() {
    if (this.data.generating) return
    this.setData({ showPopup: false })
  },

  async _saveResult(published) {
    const {
      resultImage,
      personImage,
      clothesImage,
      personSourceFileId,
      clothesSourceFileId,
      resultSourceFileId,
      clothesType,
      lastAiRequestId
    } = this.data
    if (!resultImage) return false

    const userKey = (app && typeof app.getActiveUserKey === 'function' && app.getActiveUserKey()) || ''
    if (!userKey) {
      wx.showToast({ title: '\u767b\u5f55\u72b6\u6001\u5df2\u5931\u6548', icon: 'none' })
      return false
    }

    const workId = `w_${Date.now()}_${Math.floor(Math.random() * 100000)}`
    this.setData({ generating: true })

    try {
      let personFileId = String(personSourceFileId || '')
      let clothesFileId = String(clothesSourceFileId || '')
      let resultFileId = String(resultSourceFileId || '')

      if (!personFileId) {
        personFileId = (
          await uploadFileToCloud(`works/${userKey}/${workId}/person.${getFileExt(personImage, 'jpg')}`, personImage)
        ).fileID
      }
      if (!clothesFileId) {
        clothesFileId = (
          await uploadFileToCloud(`works/${userKey}/${workId}/clothes.${getFileExt(clothesImage, 'jpg')}`, clothesImage)
        ).fileID
      }

      const resultImageClean = String(resultImage || '').trim()
      if (!resultFileId) {
        if (/^https?:\/\//i.test(resultImageClean)) {
          const transferRes = await callCloudTryon('saveResultToCloud', {
            imageUrl: resultImageClean,
            cloudPath: `works/${userKey}/${workId}/result.${getFileExt(resultImageClean, 'jpg')}`
          })
          resultFileId = (transferRes && transferRes.fileId) || ''
        } else {
          resultFileId = (
            await uploadFileToCloud(
              `works/${userKey}/${workId}/result.${getFileExt(resultImageClean, 'jpg')}`,
              resultImageClean
            )
          ).fileID
        }
      }

      if (!resultFileId) {
        throw new Error('\u7ed3\u679c\u56fe\u8f6c\u5b58\u5931\u8d25')
      }

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
        source: 'ai_tryon',
        meta: {
          clothesType,
          aiRequestId: lastAiRequestId || ''
        }
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
        clothesImage: '',
        personSourceFileId: '',
        clothesSourceFileId: '',
        resultSourceFileId: '',
        lastAiRequestId: ''
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
      personSourceFileId: '',
      clothesSourceFileId: '',
      resultSourceFileId: '',
      lastAiRequestId: ''
    })
    wx.showToast({ title: '\u5df2\u53d6\u6d88', icon: 'none', duration: 1000 })
  }
})