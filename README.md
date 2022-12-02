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
  - 解析CSV檔案，title為Delete-Infor的是需要刪除的判決書資料，依照第四項裁判ID去做資料庫的刪除動作
  ```
  刪除日期,裁判日期年月,法院名稱,裁判ID
  20200615,200204,臺灣高等法院臺中分院民事,"TCHV,91,家抗,49,20020423,1"
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
      - 
      - serial `string`                     // 裁判書 ID 第六個參數
    - judicialDataset                       // *裁判書資料集表*
      - id `int`                            // 資料集Id
      - title `string`                      // 資料集名稱
      - categoryName `string`               // 主題分類名稱
      - filesets `json`                     // 字別(此欄位會多筆)
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