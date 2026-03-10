// edit-profile.js
const app = getApp()
const { requireLoginGate } = require('../../utils/auth-guard')
const { getScoped, setScoped } = require('../../utils/scoped-storage')

const STORAGE_PROFILE = 'profile'
const DEFAULT_STYLE_TAGS = [
  { label: '\u8857\u5934', selected: false },
  { label: '\u751c\u7f8e', selected: false },
  { label: '\u901a\u52e4', selected: false },
  { label: '\u8fd0\u52a8', selected: false },
  { label: '\u65e5\u5e38', selected: false },
  { label: '\u7b80\u7ea6', selected: false },
  { label: '\u590d\u53e4', selected: false },
  { label: '\u4f11\u95f2', selected: false }
]

const BODY_TYPES = [
  { value: 'apple', label: '\u82f9\u679c\u578b', icon: 'A' },
  { value: 'pear', label: '\u68a8\u5f62', icon: 'P' },
  { value: 'hourglass', label: '\u6c99\u6f0f\u578b', icon: 'H' },
  { value: 'rectangle', label: '\u77e9\u5f62', icon: 'R' },
  { value: 'inverted', label: '\u5012\u4e09\u89d2', icon: 'I' }
]

const SHOE_SIZES = ['\u8bf7\u9009\u62e9', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45']

function calcBMI(heightCm, weightKg) {
  if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) return ''
  const h = heightCm / 100
  return (weightKg / (h * h)).toFixed(1)
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

function callCloudImages(action, payload) {
  const safePayload = payload || {}
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('\u4e91\u80fd\u529b\u4e0d\u53ef\u7528'))
      return
    }

    wx.cloud.callFunction({
      name: 'images_v1',
      data: Object.assign({ action: action }, safePayload),
      success: (res) => {
        const result = (res && res.result) || {}
        if (result.ok === false) {
          reject(new Error(result.message || '\u5934\u50cf\u4e91\u51fd\u6570\u8c03\u7528\u5931\u8d25'))
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
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      reject(new Error('\u4e91\u4e0a\u4f20\u80fd\u529b\u4e0d\u53ef\u7528'))
      return
    }

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath,
      success: (res) => resolve(res),
      fail: (err) => reject(err)
    })
  })
}

function normalizeStyleTags(styleTags) {
  const source = Array.isArray(styleTags) && styleTags.length ? styleTags : DEFAULT_STYLE_TAGS
  return source.map((t) => {
    if (typeof t === 'string') return { label: t, selected: false }
    return { label: String(t.label || ''), selected: !!t.selected }
  })
}

Page({
  data: {
    editMode: false,
    hintAnim: true,
    avatarUrl: '',
    nickname: '',
    gender: '',
    height: 165,
    weight: '',
    bust: '',
    waist: '',
    hip: '',
    bodyType: '',
    measurementsOpen: true,
    extendedOpen: false,
    profileUpdated: false,
    bodyTypes: BODY_TYPES,
    styleTags: DEFAULT_STYLE_TAGS.map((t) => ({ label: t.label, selected: !!t.selected })),
    skinTone: '',
    skinTemp: '',
    shoeSizes: SHOE_SIZES,
    shoeSizeIndex: 0,
    sizeTop: '',
    sizePants: '',
    sizeShoePref: '',
    bmi: ''
  },

  _loginRedirecting: false,

  _requireLogin(options) {
    return requireLoginGate(this, options || {})
  },

  async onLoad() {
    if (!this._requireLogin({ toast: false })) return
    await this.loadProfile()
  },

  onShow() {
    this._requireLogin()
  },

  _buildProfileFromData() {
    const d = this.data
    return {
      nickname: d.nickname,
      avatarUrl: d.avatarUrl,
      gender: d.gender,
      height: d.height,
      weight: d.weight,
      bust: d.bust,
      waist: d.waist,
      hip: d.hip,
      bodyType: d.bodyType,
      measurementsOpen: d.measurementsOpen,
      extendedOpen: d.extendedOpen,
      styleTags: d.styleTags,
      skinTone: d.skinTone,
      skinTemp: d.skinTemp,
      shoeSizeIndex: d.shoeSizeIndex,
      sizeTop: d.sizeTop,
      sizePants: d.sizePants,
      sizeShoePref: d.sizeShoePref
    }
  },

  _applyProfile(profile) {
    const p = profile || {}
    const styleTags = normalizeStyleTags(p.styleTags)
    this.setData({
      nickname: p.nickname || this.data.nickname,
      avatarUrl: p.avatarUrl || this.data.avatarUrl,
      gender: p.gender || '',
      height: p.height !== undefined && p.height !== null ? p.height : 165,
      weight: p.weight || '',
      bust: p.bust || '',
      waist: p.waist || '',
      hip: p.hip || '',
      bodyType: p.bodyType || '',
      measurementsOpen: p.measurementsOpen !== false,
      extendedOpen: !!p.extendedOpen,
      styleTags: styleTags,
      skinTone: p.skinTone || '',
      skinTemp: p.skinTemp || '',
      shoeSizeIndex: typeof p.shoeSizeIndex === 'number' ? p.shoeSizeIndex : 0,
      sizeTop: p.sizeTop || '',
      sizePants: p.sizePants || '',
      sizeShoePref: p.sizeShoePref || '',
      profileUpdated: false
    })
    this.updateBMI()
  },

  async loadProfile() {
    const localUser = app.globalData.userInfo || getScoped(app, 'userInfo', {}) || {}
    this.setData({
      avatarUrl: localUser.avatarUrl || this.data.avatarUrl,
      nickname: localUser.nickName || this.data.nickname || '\u7528\u6237'
    })

    const localProfile = getScoped(app, STORAGE_PROFILE, {}) || {}
    this._applyProfile(localProfile)

    try {
      const res = await callCloudAuth('getProfile')
      const cloudProfile = res.profile || {}
      const cloudUser = res.user || {}
      const mergedProfile = Object.assign({}, localProfile || {}, cloudProfile || {}, {
        nickname: cloudProfile.nickname || cloudUser.nickname || localProfile.nickname || this.data.nickname,
        avatarUrl: cloudProfile.avatarUrl || cloudUser.avatarUrl || localProfile.avatarUrl || this.data.avatarUrl
      })

      this._applyProfile(mergedProfile)
      setScoped(app, STORAGE_PROFILE, mergedProfile)

      const baseUserInfo = app.globalData.userInfo || getScoped(app, 'userInfo', {}) || {}
      const userInfo = Object.assign({}, baseUserInfo || {}, {
        nickName: mergedProfile.nickname || baseUserInfo.nickName || '\u7528\u6237',
        avatarUrl: mergedProfile.avatarUrl || baseUserInfo.avatarUrl || ''
      })
      app.globalData.userInfo = userInfo
      setScoped(app, 'userInfo', userInfo)
      if (typeof app.hydrateUserScopedData === 'function') app.hydrateUserScopedData()
    } catch (e) {}
  },

  async saveProfile() {
    const profile = this._buildProfileFromData()
    setScoped(app, STORAGE_PROFILE, profile)

    const baseUserInfo = app.globalData.userInfo || getScoped(app, 'userInfo', {}) || {}
    const userInfo = Object.assign({}, baseUserInfo || {}, {
      nickName: profile.nickname,
      avatarUrl: profile.avatarUrl
    })
    app.globalData.userInfo = userInfo
    setScoped(app, 'userInfo', userInfo)
    if (typeof app.hydrateUserScopedData === 'function') app.hydrateUserScopedData()

    try {
      const cloudRes = await callCloudAuth('saveProfile', { profile: profile })
      const cloudUser = (cloudRes && cloudRes.user) || {}
      const cloudProfile = (cloudRes && cloudRes.profile) || profile

      setScoped(app, STORAGE_PROFILE, cloudProfile)
      const syncUserInfo = Object.assign({}, userInfo || {}, {
        nickName: cloudUser.nickname || cloudProfile.nickname || userInfo.nickName,
        avatarUrl: cloudUser.avatarUrl || cloudProfile.avatarUrl || userInfo.avatarUrl
      })
      app.globalData.userInfo = syncUserInfo
      setScoped(app, 'userInfo', syncUserInfo)
      if (typeof app.hydrateUserScopedData === 'function') app.hydrateUserScopedData()
      return true
    } catch (e) {
      return false
    }
  },

  updateBMI() {
    const height = this.data.height
    const weight = this.data.weight
    this.setData({ bmi: calcBMI(height, weight) })
  },

  markProfileUpdated() {
    this.setData({ profileUpdated: true })
    setTimeout(() => this.setData({ profileUpdated: false }), 3000)
  },

  onBack() {
    wx.navigateBack()
  },

  async onSaveOrDone() {
    if (!this._requireLogin()) return
    if (this.data.editMode) {
      const ok = await this.saveProfile()
      wx.showToast({ title: ok ? '\u5df2\u4fdd\u5b58' : '\u4ec5\u672c\u5730\u4fdd\u5b58', icon: ok ? 'success' : 'none' })
      this.setData({ editMode: false })
    } else {
      this.setData({ editMode: true })
    }
  },

  onChangeAvatar() {
    if (!this._requireLogin() || !this.data.editMode) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const temp = (res && res.tempFiles && res.tempFiles[0]) || null
        if (!temp || !temp.tempFilePath) {
          wx.showToast({ title: '\u672a\u9009\u62e9\u56fe\u7247', icon: 'none' })
          return
        }

        try {
          const userKey = (app && typeof app.getActiveUserKey === 'function' && app.getActiveUserKey()) || 'anon'
          const cloudPath = `images/${userKey}/current_avatar.jpg`

          const uploadRes = await uploadFileToCloud(cloudPath, temp.tempFilePath)
          const fileId = (uploadRes && uploadRes.fileID) || ''
          if (!fileId) throw new Error('\u5934\u50cf\u4e0a\u4f20\u5931\u8d25')

          const imgRes = await callCloudImages('saveAvatar', {
            avatarUrl: fileId,
            fileId: fileId,
            source: 'edit_profile',
            meta: {
              size: Number(temp.size) || 0,
              width: Number(temp.width) || 0,
              height: Number(temp.height) || 0,
              mimeType: String(temp.fileType || '')
            }
          })

          const nextAvatarUrl = (imgRes && imgRes.user && imgRes.user.avatarUrl) || fileId
          this.setData({ avatarUrl: nextAvatarUrl })
          this.markProfileUpdated()

          const currentProfile = getScoped(app, STORAGE_PROFILE, {}) || {}
          setScoped(app, STORAGE_PROFILE, Object.assign({}, currentProfile || {}, { avatarUrl: nextAvatarUrl }))

          const baseUserInfo = app.globalData.userInfo || getScoped(app, 'userInfo', {}) || {}
          const nextUserInfo = Object.assign({}, baseUserInfo || {}, { avatarUrl: nextAvatarUrl })
          app.globalData.userInfo = nextUserInfo
          setScoped(app, 'userInfo', nextUserInfo)
          if (typeof app.hydrateUserScopedData === 'function') app.hydrateUserScopedData()

          wx.showToast({ title: '\u5934\u50cf\u5df2\u66f4\u65b0', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: (e && e.message) || '\u5934\u50cf\u4e0a\u4f20\u5931\u8d25', icon: 'none' })
        }
      }
    })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  onGenderTap(e) {
    if (!this._requireLogin() || !this.data.editMode) return
    this.setData({ gender: e.currentTarget.dataset.value })
    this.markProfileUpdated()
  },

  onHeightChange(e) {
    if (!this._requireLogin()) return
    const height = parseInt(e.detail.value, 10)
    this.setData({ height: height })
    this.updateBMI()
    this.markProfileUpdated()
  },

  onWeightInput(e) {
    if (!this._requireLogin()) return
    this.setData({ weight: e.detail.value })
    this.updateBMI()
    this.markProfileUpdated()
  },

  onBustInput(e) {
    if (!this._requireLogin()) return
    this.setData({ bust: e.detail.value })
    this.markProfileUpdated()
  },

  onWaistInput(e) {
    if (!this._requireLogin()) return
    this.setData({ waist: e.detail.value })
    this.markProfileUpdated()
  },

  onHipInput(e) {
    if (!this._requireLogin()) return
    this.setData({ hip: e.detail.value })
    this.markProfileUpdated()
  },

  onBodyTypeTap(e) {
    if (!this._requireLogin() || !this.data.editMode) return
    this.setData({ bodyType: e.currentTarget.dataset.value })
    this.markProfileUpdated()
  },

  toggleMeasurements() {
    if (!this._requireLogin()) return
    this.setData({ measurementsOpen: !this.data.measurementsOpen })
  },

  toggleExtended() {
    if (!this._requireLogin()) return
    this.setData({ extendedOpen: !this.data.extendedOpen })
  },

  onStyleTagTap(e) {
    if (!this._requireLogin() || !this.data.editMode) return
    const index = e.currentTarget.dataset.index
    const tags = (this.data.styleTags || []).map((x) => ({ label: x.label, selected: !!x.selected }))
    if (tags[index]) tags[index].selected = !tags[index].selected
    this.setData({ styleTags: tags })
    this.markProfileUpdated()
  },

  onSkinToneTap(e) {
    if (!this._requireLogin() || !this.data.editMode) return
    this.setData({ skinTone: e.currentTarget.dataset.value })
    this.markProfileUpdated()
  },

  onSkinTempTap(e) {
    if (!this._requireLogin() || !this.data.editMode) return
    this.setData({ skinTemp: e.currentTarget.dataset.value })
    this.markProfileUpdated()
  },

  onShoeSizeChange(e) {
    if (!this._requireLogin() || !this.data.editMode) return
    this.setData({ shoeSizeIndex: parseInt(e.detail.value, 10) })
    this.markProfileUpdated()
  },

  onSizeTopInput(e) {
    if (!this._requireLogin()) return
    this.setData({ sizeTop: e.detail.value })
  },

  onSizePantsInput(e) {
    if (!this._requireLogin()) return
    this.setData({ sizePants: e.detail.value })
  },

  onSizeShoePrefInput(e) {
    if (!this._requireLogin()) return
    this.setData({ sizeShoePref: e.detail.value })
  },

  async onSaveAndTryon() {
    if (!this._requireLogin()) return
    const ok = await this.saveProfile()
    wx.showToast({ title: ok ? '\u5df2\u4fdd\u5b58' : '\u4ec5\u672c\u5730\u4fdd\u5b58', icon: ok ? 'success' : 'none' })
    setTimeout(() => {
      wx.switchTab({ url: '/pages/ai-quick/ai-quick' })
    }, 800)
  }
})