## 流程
- 指定主題分類代碼取得資料源清單 – 取得所有判決書
  - 判斷ID是否有紀錄
  - 判斷TITLE是否有更新
  - 若沒有ID紀錄或者TITLE有更新則記錄以下資料
    - datasetId – 資料源ID，當作資料ID。
    - title – 資料源年、月份，格式為yyyymm或者yyyymm–(yyyymmddUpdate)，判斷取得的資料是否有更新備註，有的話則更新資料庫。
    - filesets.fileSetId – 檔案ID，利用這個去取得檔案。
    - filesets.resourceFormat – 檔案類型，格式為RAR或CSV，利用這個去處理RAR檔或者CSV檔。
- 取得會員授權Token – 取得會員授權Token，帶入帳號密碼。
- 以URL存取資料 – 取得資料源檔案，依據檔案類型RAR或者CSV做資料處理。
  - 解析RAR檔案，會有資料夾階層，最底層每一筆資料為JSON檔，檔名為判決書ID，並記錄上一層的資料夾名稱(法院中文名稱)
  - 每筆判決以 `classifyRentalDispute` 判斷是否為房屋租賃糾紛，只保留符合的判決（規則見下方「房屋租賃糾紛判斷規則」）
  - 解析CSV檔案，title為Delete-Infor的是需要刪除的判決書資料，依照第四項裁判ID去做資料庫的刪除動作
  ```
  刪除日期,裁判日期年月,法院名稱,裁判ID
  20200615,200204,臺灣高等法院臺中分院民事,"TCHV,91,家抗,49,20020423,1"
  ```
  
## 房屋租賃糾紛判斷規則

規則在 `src/classifier/rental-dispute-rules.ts`，判斷流程在 `src/classifier/rental-dispute-classifier.ts`。依序檢查，任一項不符就排除：

| 順序 | 條件 | 排除理由代碼 |
|---|---|---|
| 1 | 裁判字號第一段為地方法院（D）或簡易庭（E）的民事（V），例如 `TPDV`、`TPEV` | `not-civil-district-court` |
| 2 | 第一審：字別不含上、抗、再、聲等程序用字 | `not-first-instance` |
| 3 | 文書開頭是判決（含宣示判決筆錄），不是裁定 | `not-judgment` |
| 4 | 有案由 | `missing-title` |
| 5 | 案由不是稅務、票據、工程款、買賣、借貸、繼承、土地、車位、勞動等一定無關的類型。案由含遷讓、租金、押金、返還房屋等典型租賃字詞時不套用這項排除（例如「給付租金及管理費」「返還房屋及土地」） | `excluded-title` |
| 6 | 兩造之間有租賃關係，例如「被告向原告承租」「出租予被告」「兩造簽訂租賃契約」「被告積欠租金」（不算的寫法見表格下方）。案由不是典型租賃案由（例如損害賠償、不當得利）時，必須出現在「原告主張」開頭 600 字內 | `no-lease-between-parties` |
| 7 | 租賃標的是房屋，而不是土地、停車位、車輛、設備、攤位 | `non-housing-lease` |
| 8 | 找得到租賃標的 | `no-housing-subject` |

第 6 項以下寫法不算兩造之間的租約：

- 否定或爭執租約的句子，例如「兩造間並無租賃關係」「本件爭點為兩造間是否有租賃關係」「係使用借貸而非租賃」。
- 和第三人的租約，例如「被告向訴外人／原屋主承租」「債務人將房屋出租予被告」「原告將房屋出租予丙公司」「原告房屋之承租人許某」。
- 「從未給付租金」「無償借住」。
- 「相當（於）（每月）租金之不當得利」。
- 證人證詞中的「伊」指證人，證詞只採用寫明原告、被告的租約。

「伊」在原告主張中指原告，例如「被告向伊承租」「伊將房屋轉租予被告」。

第 7、8 項只看提到租賃的句子，先看租賃動詞的受詞：「承租系爭土地建築房屋」的標的是土地，「承租大樓地下二樓停車位」的標的是停車位，「系爭房屋出租予被告」的標的是房屋。受詞是並列名詞（「土地及房屋」）時，有房屋就算房屋；「房屋所坐落之土地」算土地、「土地上之房屋」算房屋。找不到受詞時才看整句提到的標的，再來是「系爭○○」定義詞，最後才參考案由。描述兩造租約的句子優先，避免被告與第三人的土地租約蓋過兩造之間的房屋租約；「土地法第100條」「公寓大廈管理條例」這類法規名稱裡的名詞不算標的。

已知限制：

- 全文只用「甲○○」「乙○○」、沒有寫原告被告的舊判決，可能被排除。
- 第三人沒有標示「訴外人」（例如「被告向甲公司承租」）時，可能被當成兩造之間的租約。
- 房屋與非房屋標的的線索一樣多時保留。

這套規則參考房屋租賃糾紛的常見請求基礎：民法第 421、440、455 條（租賃）、第 767 條（所有物返還）、第 179 條（相當於租金之不當得利）、土地法第 100 條。舊規則只要全文同時出現「租金」與「房屋」就收錄，會混入拍定人對原屋主、借住親友、車禍損害、土地或停車位租賃等非租屋糾紛。

## 重新檢查已入庫的判決

```bash
npm run reclassify                      # dry-run：只輸出報告，不修改資料
npm run reclassify -- --output=reclassify-report-2026-11.json  # 檔名以 reclassify-report 開頭才會被 git 忽略
npm run reclassify -- --apply           # 先備份資料庫，確認報告後才執行
```

報告會列出每筆不符合判決的 ID、案由與理由。`--apply` 只刪除不符合且沒有會員留言或按讚的判決，有留言或按讚的會列在 `protectedIds` 交由人工確認。

## 資料同步工作

三個工作都只把房屋租賃糾紛判決（`classifyRentalDispute`）寫入 `judicialFileset`，同一 JID 以新內容覆蓋舊內容；不寫入 `district`。每次執行結束會輸出 JSON 摘要。程式在 `src/judicial/`（API 用戶端、CSV、RAR）、`src/sync/`（流程邏輯），腳本在 `src/scripts/sync-*.ts`。

刪除分兩種：

- **司法院移除**（Delete-Infor 清單、JDoc 回覆「查無資料…已從系統移除」）：法律義務，一定刪除。每批一個交易，先刪 `likes`、`comments` 中該判決的資料，再刪判決，摘要會列出刪除的留言、按讚數。
- **不再判定為租賃糾紛**（每日同步重新取得的判決）：與 `reclassify` 相同，只刪除沒有留言、按讚的判決，有的列在 `protectedNotRental`。

### 每日同步 `npm run sync:daily`

使用裁判書開放 API（`https://data.judicial.gov.tw/jdg/api`，帳密同資料開放平臺）：

1. `Auth` 取得 Token（有效 6 小時；回傳「驗證失敗」時重新驗證一次）。
2. `JList` 取得 7 日前異動的 JID。
3. 先以 JID 篩出地方法院／簡易庭民事第一審（法院代碼 `??DV`、`??EV`，字別不含上、抗、再等）。
4. 依序呼叫 `JDoc`（每筆間隔 `--delay-ms`，預設 300 毫秒）：已移除則刪除；是租賃糾紛則 upsert；不是則依上述規則刪除舊資料。
5. 網路錯誤與 5xx 最多重試 3 次（間隔遞增）。單筆失敗不影響其他判決，列在 `failures`，有失敗時結束代碼為 1。

API 只在每日 00:00–06:00（Asia/Taipei）服務。不在這個時段時腳本會說明原因並以結束代碼 0 結束；執行到 06:00 時停止，未處理的筆數記在 `skippedAfterServiceWindow`。

```bash
npm run sync:daily                     # 正式執行
npm run sync:daily -- --dry-run        # 不寫入資料庫（仍會讀取資料庫判斷哪些判決存在）
npm run sync:daily -- --delay-ms=500
```

### Delete-Infor 刪除清單 `npm run sync:delete-infor`

從資源清單找標題含 `Delete-Infor` 的 CSV 資料集（fileSetId 會隨更新改變），以會員 Token 下載，解析 `刪除日期,裁判日期年月,法院名稱,裁判ID`（UTF-8 BOM、CRLF、JID 以雙引號包住），每 500 筆查詢一次資料庫，存在的判決一律刪除。這是法律義務，預設直接刪除；`--dry-run` 只列出 `presentIds`。

清單中有少數 ID 缺少最後的檢查單號（例如 `TPSM,93,台上,9326,20040116`），程式仍以原字串比對，並列在 `incompleteIds` 供人工確認。解析不到任何 ID 時視為格式改變，直接失敗，不會當成沒有要刪除的判決。

```bash
npm run sync:delete-infor
npm run sync:delete-infor -- --dry-run
```

### 每月批次匯入 `npm run sync:monthly`

補資料用：資源清單中每月一個 RAR 資料集（標題如 `202609裁判書--(20261116Update)`，約 200–260 MB）。RAR 內的結構是 `YYYYMM/法院名稱＋類別/JID.json`，例如 `202609/臺北簡易庭民事/TPEV,115,北簡,9567,20260915,1.json`。程式只解出檔名 JID 為地方法院／簡易庭民事第一審的項目（202609 共 96,509 筆中約 44,720 筆），以檔案模式解壓（不會把整個 RAR 讀進記憶體），每讀完一筆就刪除，再分類並每 200 筆 upsert 一次。每個月份處理完（含失敗）都會刪除下載的 RAR 與解出的檔案。

月份各自獨立，某個月失敗不影響其他月份（結束代碼為 1），重新執行只會覆蓋相同 JID。

```bash
npm run sync:monthly -- --month=202609
npm run sync:monthly -- --from=202212 --to=202609
npm run sync:monthly -- --month=202609 --dry-run   # 不寫入資料庫
```

暫存檔放在系統暫存資料夾，可用 `TMPDIR=/data/tmp npm run sync:monthly ...` 指定，每個月份需要約 300 MB。

### 建議的 crontab（Ubuntu）

主機時區可能是 UTC。先用 `timedatectl` 確認；若 cron 支援 `CRON_TZ`，用下面第一種寫法，否則用 UTC 時間（臺北 01:10 = UTC 前一天 17:10；臺北 20 日 01:40 = UTC 19 日 17:40）。`logs/` 目錄需先建立。

```cron
CRON_TZ=Asia/Taipei
# 每日 01:10 同步裁判書開放 API（服務時間 00:00–06:00）
10 1 * * * cd /path/to/crawl-judicial-cases && npm run sync:daily >> logs/sync-daily.log 2>&1
# 每月 20 日 01:40 先處理刪除清單，再匯入兩個月前的資料
40 1 20 * * cd /path/to/crawl-judicial-cases && npm run sync:delete-infor >> logs/sync-delete-infor.log 2>&1; npm run sync:monthly -- --month=$(date -d '2 months ago' +\%Y\%m) >> logs/sync-monthly.log 2>&1
```

UTC 主機、不支援 `CRON_TZ` 時：

```cron
10 17 * * * cd /path/to/crawl-judicial-cases && npm run sync:daily >> logs/sync-daily.log 2>&1
40 17 19 * * cd /path/to/crawl-judicial-cases && npm run sync:delete-infor >> logs/sync-delete-infor.log 2>&1; npm run sync:monthly -- --month=$(date -d '2 months ago' +\%Y\%m) >> logs/sync-monthly.log 2>&1
```

月份資料集約在兩個月後的中旬發布（2026-11-26 時最新的是 202609，標題為 20261116Update），所以 20 日匯入兩個月前的資料，例如 11 月 20 日匯入 202609。若當時還沒有發布，摘要會出現 `資源清單中找不到這個月份的 RAR 資料集`，可之後再以 `--month` 補跑。

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `JUDICIAL_ACCOUNT`、`JUDICIAL_PWD` | — | 司法院資料開放平臺帳密（同步工作必填；裁判書開放 API 也使用同一組） |
| `UPSERT` | `false` | `true` 時重複的判決會被覆寫 |
| `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` | `127.0.0.1`、`3306`、`root`、空字串、`rental` | MySQL 連線 |

## 測試

```bash
npm test                # 單元測試
npm run test:coverage   # 覆蓋率（判斷規則、重新檢查與同步工作）
npm run typecheck
```

## 參考第三方 API
- 指定主題分類代碼取得資料源清單 GET https://opendata.judicial.gov.tw/data/api/rest/categories/051/resources
```
response [
    {
        "datasetId": 21736,  // 資料源ID
        "title": "199601",   // 資料源年月份
        "categoryName": "裁判書",
        "filesets": [
            {
                "fileSetId": 30441,  // 檔案ID
                "resourceFormat": "RAR",  // 檔案類型
                "resourceDescription": "199601"
            }
        ]
    },
]
```

---

- 取得會員授權Token POST https://opendata.judicial.gov.tw/api/MemberTokens
```
request {
    "memberAccount": string,  // 帳號
    "pwd": string  // 密碼
}

response {
    "token": string,  // 會員授權Token
    "expires": "2022-11-26T20:43:31.548493+08:00"
}
```

---

- 以URL存取資料 GET https://opendata.judicial.gov.tw/api/FilesetLists/{{fileSetId}}/file
```
header {
    Authorization:  // 帶入會員授權Token
}

request {
    fileSetId: 帶入資料源檔案ID
}

response file
```

## 資料庫
- mysql
  - rental
    - judicial                              // *裁判書內容表*
      - id `string`                         // 裁判書 ID
      - year `string`                       // 年度
      - case `string`                       // 字別
      - no `string`                         // 號次
      - date `string`                       // 裁判日期
      - title `string`                      // 裁判案由
      - full `string`                       // 裁判書全文
      - pdf `string`
      - code `string`                       // 裁判法院代碼
      - name `string`                       // 裁判法院名稱
      - serial `string`                     // 裁判書 ID 第六個參數
    - judicialDataset                       // *裁判書資料集表*
      - id `int`                            // 資料集Id
      - title `string`                      // 資料集名稱
      - categoryName `string`               // 主題分類名稱
      - filesets `json`                     // 資料源(此欄位會多筆)
        - fileSetId `int`                   // 資料源Id
        - resourceFormat `string`           // 檔案格式
        - resourceDescription `string`      // 料源描述

## 開發流程
- sudo service mysql start

## 裁判書開放資料說明:

 (1) 裁判書開放API(提供當日7日前之裁判書資料)：
因考慮本院網路頻寬及系統負擔，並避免損及多數一般使用者權益，本 API 提供服務時間為每日凌晨 0 時至 6 時止，其餘時間恕不提供服務。
當系統回傳「{"error":"查無資料，本裁判可能未公開或已從系統移除，若您曾經下載過本裁判，亦請您將其移除！謝謝！"}」，表示該筆裁判書業經本院移除或不再公開，使用者應將先前所取得的裁判書內容刪除，以免損害當事人隱私及權益及違反「司法院開放資料使用規範」。
規格請詳本平臺首頁/最新消息。

 (2) 裁判書開放壓縮檔(按月提供裁判書壓縮檔)：
資料為json格式，並於每月15日至20日期間，產製新月份之壓縮檔、重新打包原有壓縮檔並更新應刪除資訊(Delete-Infor.csv)。
命名規則：以裁判日期之年月命名，例如：202101.rar、202012.rar，若壓縮檔有更新，則檔名後會加上最新異動日期，如：202010--(20201220Update).rar，表示裁判年月為2020年10月的裁判書於2020年12月20日異動更新。
請每個月務必依Delete-Infor.csv異動已拿取之裁判書壓縮檔。
規格請詳本平臺/資料應用/開發指引。

## 參考資料
- [裁判書開放資料說明](https://opendata.judicial.gov.tw/QA)
- [開發指引](https://opendata.judicial.gov.tw/DevelopmentGuide)

## TODO
- 加入張淑晶案例
- 加入自動更新案例

## 裁判書更新時間 2022/02/03