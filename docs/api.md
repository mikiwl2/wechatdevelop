模特换装
最近更新时间：2025-09-12 01:07:46

我的收藏
本页目录：
1. 接口描述
2. 输入参数
3. 输出参数
4. 示例
示例1 成功
5. 开发者资源
腾讯云 API 平台
API Inspector
SDK
命令行工具
6. 错误码
1. 接口描述
接口请求域名： aiart.tencentcloudapi.com 。

上传正面全身模特照和服装平铺图，生成模特换装后的图片。
生成的换装图片分辨率和模特照分辨率一致。
模特换装默认提供1个并发任务数，代表最多能同时处理1个已提交的任务，上一个任务处理完毕后才能开始处理下一个任务。

推荐使用 API Explorer
点击调试
API Explorer 提供了在线调用、签名验证、SDK 代码生成和快速检索接口等能力。您可查看每次调用的请求内容和返回结果以及自动生成 SDK 调用示例。
2. 输入参数
以下请求参数列表仅列出了接口请求参数和部分公共参数，完整公共参数列表见 公共请求参数。

参数名称	必选	类型	描述
Action	是	String	公共参数，本接口取值：ChangeClothes。
Version	是	String	公共参数，本接口取值：2022-12-29。
Region	是	String	公共参数，详见产品支持的 地域列表。
ModelUrl	是	String	模特图片 Url。
图片限制：单边分辨率小于3000，且大于512，转成 Base64 字符串后小于 8MB。
输入要求：
1、建议上传正面模特图片，至少完整露出应穿着输入指定服装的身体部位（全身、上半身或下半身），无大角度身体偏转或异常姿势。
2、建议上传3:4比例的图片，生成效果更佳。
3、建议模特图片中的原始服装和更换后的服装类别一致，或原始服装在身体上的覆盖范围小于等于更换后的服装（例如需要给模特换上短裤，则原始模特图片中也建议穿短裤，不建议穿长裤），否则会影响人像生成效果。

示例值：https://cos.ap-guangzhou.myqcloud.com/model.jpg
ClothesUrl	是	String	服装图片 Url。
图片限制：单边分辨率小于3000，大于512，转成 Base64 字符串后小于 8MB。
输入要求：
建议上传服装完整的正面平铺图片，仅包含1个服装主体，服装类型支持上衣、下装、连衣裙，三选一。算法将根据输入的图片，结合服装图片给模特换装。
示例值：https://cos.ap-guangzhou.myqcloud.com/cloth.jpg
ClothesType	是	String	服装类型，需要和服装图片保持一致。
取值：
Upper-body：上衣
Lower-body：下装
Dress：连衣裙
示例值：Upper-body
LogoAdd	否	Integer	为生成结果图添加标识的开关，默认为1。
1：添加标识。
0：不添加标识。
其他数值：默认按1处理。
建议您使用显著标识来提示结果图使用了 AI 绘画技术，是 AI 生成的图片。
示例值：1
LogoParam	否	LogoParam	标识内容设置。
默认在生成结果图右下角添加“图片由 AI 生成”字样，您可根据自身需要替换为其他的标识图片。
示例值：{"LogoUrl": "https://cos.ap-guangzhou.myqcloud.com/logo.jpg", "LogoRect": {"X": 10, "Y": 10, "Width": 20, "Height": 20}}
RspImgType	否	String	返回图像方式（base64 或 url) ，二选一，默认为 base64。url 有效期为1小时。
生成图分辨率较大时建议选择 url，使用 base64 可能因图片过大导致返回失败。
示例值：url
3. 输出参数
参数名称	类型	描述
ResultImage	String	根据入参 RspImgType 填入不同，返回不同的内容。
如果传入 base64 则返回生成图 Base64 编码。
如果传入 url 则返回的生成图 URL , 有效期1小时，请及时保存。
示例值：https://xxx.cos.ap-guangzhou.myqcloud.com/xxx.jpg
RequestId	String	唯一请求 ID，由服务端生成，每次请求都会返回（若请求因其他原因未能抵达服务端，则该次请求不会获得 RequestId）。定位问题时需要提供该次请求的 RequestId。
4. 示例
示例1 成功
输入示例
POST / HTTP/1.1
Host: aiart.tencentcloudapi.com
Content-Type: application/json
X-TC-Action: ChangeClothes
<公共请求参数>

{
    "ModelUrl": "https://cos.ap-guangzhou.myqcloud.com/model.jpg",
    "ClothesUrl": "https://cos.ap-guangzhou.myqcloud.com/cloth.jpg",
    "ClothesType": "Upper-body",
    "RspImgType": "url"
}
输出示例
{
    "Response": {
        "RequestId": "0d0728ed-f777-4861-aa4b-5a6167daa0b6",
        "ResultImage": "https://aiart-xxx.cos.ap-guangzhou.myqcloud.com/xxx.jpg?q-sign-algorithm=sha1&q-ak=xxxxx&q-sign-time=1731574045;1731577645&q-key-time=1731574045;1731577645&q-header-list=host&q-url-param-list=&q-signature=31fe75c1c18c3d91db59508961209dd37aaf41c7"
    }
}
5. 开发者资源
腾讯云 API 平台
腾讯云 API 平台 是综合 API 文档、错误码、API Explorer 及 SDK 等资源的统一查询平台，方便您从同一入口查询及使用腾讯云提供的所有 API 服务。

API Inspector
用户可通过 API Inspector 查看控制台每一步操作关联的 API 调用情况，并自动生成各语言版本的 API 代码，也可前往 API Explorer 进行在线调试。

SDK
云 API 3.0 提供了配套的开发工具集（SDK），支持多种编程语言，能更方便的调用 API。

Tencent Cloud SDK 3.0 for Python: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for Java: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for PHP: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for Go: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for Node.js: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for .NET: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for C++: CNB, GitHub, Gitee
Tencent Cloud SDK 3.0 for Ruby: CNB, GitHub, Gitee
命令行工具
Tencent Cloud CLI 3.0
6. 错误码
以下仅列出了接口业务逻辑相关的错误码，其他错误码详见 公共错误码。

错误码	描述
AuthFailure.UnauthorizedOperation	无权执行该操作，请检查您的CAM策略，确保您拥有对应的CAM权限。
FailedOperation.GenerateImageFailed	生成图片审核不通过，请重试。
FailedOperation.ImageDecodeFailed	图片解码失败。
FailedOperation.ImageDownloadError	图片下载错误。
FailedOperation.ImageResolutionExceed	图片分辨率过大，超过2000*2000。
FailedOperation.ImageSizeExceed	base64编码后的图片数据大小不超过10M。
FailedOperation.InnerError	服务内部错误，请稍后重试。
FailedOperation.RequestEntityTooLarge	整个请求体太大（通常主要是图片）。
FailedOperation.RequestTimeout	后端服务超时。
FailedOperation.RpcFail	RPC请求失败，一般为算法微服务故障。
FailedOperation.ServerError	服务内部错误。
FailedOperation.Unknown	未知错误。
InvalidParameter.InvalidParameter	参数不合法。
InvalidParameterValue.ImageEmpty	图片为空。
InvalidParameterValue.ParameterValueError	参数字段或者值有误
InvalidParameterValue.StyleConflict	1xx和其他风格不可混合使用。
InvalidParameterValue.TextLengthExceed	输入文本过长，请更换短一点的文本后重试。
InvalidParameterValue.UrlIllegal	URL格式不合法。
OperationDenied.ImageIllegalDetected	图片包含违法违规信息，审核不通过。
OperationDenied.TextIllegalDetected	文本包含违法违规信息，审核不通过。
RequestLimitExceeded	请求的次数超过了频率限制。
RequestLimitExceeded.JobNumExceed	同时处理的任务数过多，请稍后重试。
ResourceUnavailable.Delivering	资源正在发货中。
ResourceUnavailable.InArrears	账号已欠费。
ResourceUnavailable.LowBalance	余额不足。
ResourceUnavailable.NotExist	计费状态未知，请确认是否已在控制台开通服务。
ResourceUnavailable.StopUsing	账号已停服。
ResourcesSoldOut.ChargeStatusException	计费状态异常。

示例代码：
// Depends on tencentcloud-sdk-nodejs version 4.0.3 or higher

const tencentcloud = require("tencentcloud-sdk-nodejs-aiart");

const AiartClient = tencentcloud.aiart.v20221229.Client;

// 密钥信息从环境变量读取，需要提前在环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY
// 使用环境变量方式可以避免密钥硬编码在代码中，提高安全性
// 生产环境建议使用更安全的密钥管理方案，如密钥管理系统(KMS)、容器密钥注入等
// 请参见：https://cloud.tencent.com/document/product/1278/85305
// 密钥可前往官网控制台 https://console.cloud.tencent.com/cam/capi 进行获取
const clientConfig = {
  credential: {
    secretId: process.env.TENCENTCLOUD_SECRET_ID,
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
  },
// 使用临时密钥示例
/*
  credential: {
    secretId: "SecretId",
    secretKey: "SecretKey",
    token: "Token",
  }
*/
  region: "",
  profile: {
    httpProfile: {
      endpoint: "aiart.tencentcloudapi.com",
    },
  },
};

// 实例化要请求产品的client对象,clientProfile是可选的
const client = new AiartClient(clientConfig);
const params = {};
client.ChangeClothes(params).then(
  (data) => {
    console.log(data);
  },
  (err) => {
    console.error("error", err);
  }
);