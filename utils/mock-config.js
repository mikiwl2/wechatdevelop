function getEnvVersion() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync()
    return (info && info.miniProgram && info.miniProgram.envVersion) || 'develop'
  } catch (e) {
    return 'develop'
  }
}

function shouldUseMockData() {
  // Default OFF to avoid mixing mock and real user data.
  let enabled = false

  // Optional override for debugging.
  try {
    const override = wx.getStorageSync('ENABLE_MOCK_DATA')
    if (typeof override === 'boolean') enabled = override
    if (override === '1' || override === 1 || override === 'true') enabled = true
    if (override === '0' || override === 0 || override === 'false') enabled = false
  } catch (e) {}

  return enabled
}

module.exports = {
  getEnvVersion,
  shouldUseMockData
}