const STORAGE_PUBLIC_FEED = 'publicPublishedWorks'

function getPublicFeed() {
  try {
    const list = wx.getStorageSync(STORAGE_PUBLIC_FEED)
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

function savePublicFeed(list) {
  try {
    wx.setStorageSync(STORAGE_PUBLIC_FEED, Array.isArray(list) ? list : [])
  } catch (e) {}
}

function upsertPublicWork(work) {
  if (!work || typeof work !== 'object') return
  const item = Object.assign({}, work || {})
  if (!item.id) item.id = 'pub_' + Date.now() + '_' + Math.floor(Math.random() * 1000)
  if (item.published === false) return

  const list = getPublicFeed()
  const index = list.findIndex((x) => x && x.id === item.id)
  if (index >= 0) {
    list[index] = Object.assign({}, list[index] || {}, item || {}, { published: true })
  } else {
    list.unshift(Object.assign({}, item || {}, { published: true }))
  }

  list.sort((a, b) => (b && b.createdAt ? b.createdAt : 0) - (a && a.createdAt ? a.createdAt : 0))
  savePublicFeed(list)
}

function removePublicWork(workId) {
  if (!workId) return
  const list = getPublicFeed().filter((x) => x && x.id !== workId)
  savePublicFeed(list)
}

module.exports = {
  getPublicFeed,
  upsertPublicWork,
  removePublicWork
}