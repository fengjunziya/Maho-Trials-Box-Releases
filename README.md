<!-- maho-current-application:start -->
## 客户端下载（v1.0.4）

- [Windows x64 安装版](https://github.com/fengjunziya/Maho-Trials-Box-Releases/releases/download/app-v1.0.4/MahoTrialsBox-v1.0.4-win-x64-setup.exe)
- [Windows x64 免安装版](https://github.com/fengjunziya/Maho-Trials-Box-Releases/releases/download/app-v1.0.4/MahoTrialsBox-v1.0.4-win-x64.zip)
- [版本说明与校验文件](https://github.com/fengjunziya/Maho-Trials-Box-Releases/releases/tag/app-v1.0.4)

两种版本功能相同。先退出旧程序，安装至独立空目录或完整解压后运行 MahoTrialsBox.exe。首次启动选择完整数据目录，默认是程序文件夹旁的 MahoTrialsBoxData；沿用数据时定位包含 maho-client-data.json 的目录，保留进度、记忆和音频备份。GPT-SoVITS 通用环境独立下载或在客户端部署。

自动更新使用 schema 2 签名模块清单，仅下载变化模块，最低支持 1.0.2；更早版本请使用完整包。module-*.zip 和 stable.json/stable.sig 由客户端使用，无需手工安装。旧 v0.1 更新入口已退役。问题目录继续使用独立的 latest 发布，不受客户端版本发布影响。
<!-- maho-current-application:end -->

# Maho Trials Box question releases

将工作室“导出发布包”产生的完整目录上传到仓库根目录：

```text
questions-<timestamp>-<id>/bundle.json
questions-<timestamp>-<id>/review.json
questions-<timestamp>-<id>/audio/*.wav
```

“导出工程／草稿”允许半成品，不具有新包发布资格。导出包含整个工程，请只收录新题，不把旧题重新导出为新目录。

## 发布检查

推送到main后，Actions先同步线上最新签名目录，验证固定公钥及commit下的正文哈希，不下载已发布音频。同步失败即中止，不当作空库。

原样保留的已发布目录可沿用；新包与已发布问题ID重复，无论正文是否相同，都拒绝发布。同次上传的包内或跨包重复ID也拒绝。修改或遗漏已发布包会拒绝，旧文件无需为新规则补审核记录。

冲突详情打印到Actions日志，并保存为catalog-conflicts.json；失败运行会上传question-catalog-conflicts附件。其中包括ID、新旧问题包路径、正文和题目位置，按从0起的index定位。

新包必须包含review.json：维护者已审核人物表达和事实、日语翻译及称谓，并逐段试听声音、发音和情绪。该记录绑定bundle.json及所有引用WAV的路径、大小和SHA-256；导出后修改内容须重新审核导出。机器校验不代替人工语义判断或试听。

Actions还检查分段顺序及拼接、允许的姿势ID、非空日语、WAV结构、音频哈希和资源容量。bundle.json最多10 MB（10×1024×1024字节），单个WAV最多20,000,000字节，每包正文与音频合计最多500,000,000字节。每包最多1000题、每题100段；全库最多20,000题、1000包、2,000,000,000字节，清单最多5,000,000字节。

可运行node scripts/publish-catalog.cjs --check执行相同预检查，设置GITHUB_REPOSITORY、GITHUB_SHA与新的CATALOG_OUTPUT目录；不需要私钥，不创建Release。

## 签名与客户端

全部检查通过后，用Actions Secret QUESTION_SIGNING_PRIVATE_KEY中的PEM Ed25519私钥签名；它必须匹配客户端内置公钥。公钥只来自受信任的本地配置，绝不从未签名远端响应学习。妥善备份私钥，不上传私钥、API密钥、用户数据或模型权重；仅发布有再分发许可的资源。

成功运行创建新Catalog Release，上传release-manifest.json和release-manifest.sig并设为latest。清单将资源固定到确切Git commit，客户端验签、校验每个文件哈希后入库。失败运行不创建目录Release，不删除远端文件或客户端内容。

应用及语音资源Release应保持非latest，以免遮挡问题目录。旧客户端仍有1.5 MB的bundle.json上限；超过旧上限的问题包需要用户先升级到支持10 MB的客户端。

工作流和脚本拥有签名权限，需限制仓库写权限并审查其变更。不向pull_request事件提供签名Secret。

仓库.gitattributes禁止对签名正文、审核记录和WAV进行Git文本换行转换。旧Windows检出若已有CRLF差异，请保留原文件并在隔离目录使用Git提交原始字节预检，不绕过哈希校验。

## 明确声明的语音替换

仅替换已发布语音时，根目录的 `audio-replacements.json` 绑定当前已签名目录的 commit、旧包目录和 content_hash，以及对应的新包目录。旧目录从当前树中移出，新包保留原问题 ID 和顺序；正文、译文、假名稿、分段、立绘和来源记录须完全一致，每段音频须换成新的引用。新包仍须包含实际完成试听后生成的 review.json。未声明的删除、重复 ID 或正文修改继续拒绝。

发布清单包含签名保护的 audio_replacement 内容证明。支持此流程的客户端仅更新问题库中的语音字段，保留用户进度、已发生场景快照和旧音频；同一内置初始问题版本不会把更新后的语音改回旧版本。旧客户端尚不支持同 ID 语音替换，需要升级客户端后安装这些新包。历史 Git 提交和旧 Catalog Release 保留用于恢复；“删除旧包”只移除 main 当前目录，不改写远端历史。
