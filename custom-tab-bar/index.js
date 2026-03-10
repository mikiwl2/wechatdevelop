// 自定义底部 TabBar：文字 + emoji 图标 + 渐变选中态
const { isLoggedIn } = require('../utils/auth-guard')

Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/ai-quick/ai-quick',
        text: 'AI试衣',
        icon: '✨'
      },
      {
        pagePath: '/pages/index/index',
        text: 'AI衣橱',
        icon: '👗'
      },
      {
        pagePath: '/pages/mine/mine',
        text: '我的',
        icon: '👤'
      }
    ]
  },
  methods: {
    onSwitch(e) {
      const index = e.currentTarget.dataset.index
      const item = this.data.list[index]
      if (!item) return
      if (index === this.data.selected) return

      // 未登录时只允许进入“我的”登录页
      if (index !== 2 && !isLoggedIn()) {
        this.setData({ selected: 2 })
        wx.switchTab({ url: '/pages/mine/mine' })
        wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      this.setData({ selected: index })
      wx.switchTab({ url: item.pagePath })
    },
    // 供页面在 onShow 中调用，保持选中态同步
    setSelected(index) {
      if (typeof index !== 'number') return
      if (index === this.data.selected) return
      this.setData({ selected: index })
    }
  }
})