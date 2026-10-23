# Hướng dẫn nhanh — Multi-ISP Domain Checker

Extension VS Code có ba chế độ: **Kết nối đa ISP**, **DNS records**, **HTTP / WAF**. Để kiểm tra request chậm/timeout, chọn **HTTP / WAF**; để xem domain trỏ tới đâu, chọn **DNS records**.

## 1. Mở tool

Cần VS Code 1.90 trở lên. Bản này có `dist/` đã biên dịch, nên có thể mở và chạy ngay:

1. **File → Open Folder**: mở thư mục có `package.json`.
2. Nhấn **F5**, chọn **Run Multi-ISP Checker** nếu được hỏi.
3. Trong cửa sổ **Extension Development Host** vừa mở, bấm biểu tượng mạng **Multi-ISP Checker** ở thanh bên trái.
4. Chọn chế độ, nhập **Domain / URL**, bấm nút chạy tương ứng.

Có thể dùng Command Palette → **Multi-ISP: Test Domain** để mở sidebar. Nếu sửa mã nguồn, chạy `npm.cmd run compile` trước khi F5; trên macOS/Linux dùng `npm run compile`. Nếu chưa có dependencies, chạy `npm.cmd install` trước.

**Local** là máy đang chạy extension host. Khi dùng SSH/container, đó có thể là máy remote/container, không phải máy đang hiển thị VS Code.

| Mục tiêu | Cách nhập |
|---|---|
| Website HTTPS | `example.com` hoặc `https://example.com/` |
| HTTP | `http://example.com/` |
| Endpoint cụ thể | `https://example.com/api/health?check=1` |
| Cổng khác | `https://example.com:8443/health` |
| DNS SRV | `_sip._tcp.example.com` |

URL mặc định dùng HTTPS/cổng 443. Không đặt username/password trong URL; dùng trường **Headers** ở chế độ HTTP / WAF khi cần xác thực. Tool gửi path/query thực tế; query trong báo cáo được che giá trị.

## 2. DNS records — xem bản ghi domain

1. Chọn **DNS records**, nhập domain.
2. Chọn loại cần xem; mặc định **A, AAAA, CNAME**.
3. Giữ **DNS resolver** trống để dùng DNS cấu hình trên máy extension; hoặc nhập `1.1.1.1`, `8.8.8.8`, `127.0.0.1:5300`, `[::1]:5300`.
4. Giữ **Theo chuỗi CNAME** nếu cần biết alias dẫn tới đâu.
5. Bấm **Tra cứu DNS**. Bảng hiển thị tên/loại, giá trị, TTL, trạng thái và thời gian truy vấn. Có thể bấm **Dừng**.

| Loại | Thông tin hiển thị |
|---|---|
| A / AAAA | Địa chỉ IPv4 / IPv6 và TTL (giây) |
| CNAME | Tên đích của alias |
| MX | Priority và mail server |
| TXT | Chuỗi của từng record; các segment cùng record được ghép lại |
| NS | Nameserver |
| SOA | Nameserver chính, hostmaster, serial, refresh, retry, expire, minimum TTL |
| CAA | Critical flag và trường như issue/issuewild/iodef |
| SRV | Priority, weight, port và target; nhập đầy đủ tên service |

TTL chỉ hiện khi API truy vấn cung cấp: hiện A/AAAA có TTL, loại khác là **—**, không có nghĩa TTL bằng 0. Xem **Structured data** để đọc các trường chi tiết.

Mỗi loại là một truy vấn riêng, không dùng `ANY` và không liệt kê được toàn bộ record/subdomain của một zone. Theo CNAME tối đa **8 alias**, cảnh báo nếu gặp vòng lặp hoặc chạm giới hạn, rồi lấy A/AAAA tại đích đã đi tới. Khi bật tùy chọn này, kết quả có thể có thêm CNAME/A/AAAA ngoài các loại đã chọn. Tắt tùy chọn để chỉ hỏi các loại đã chọn.

- `ok`: có bản ghi.
- `no-data`: không có bản ghi cho loại này; domain vẫn có thể tồn tại.
- `not-found`: resolver trả NXDOMAIN/không tìm thấy tên.
- `timeout` / `error`: quá thời gian chờ / lỗi resolver; không kết luận tên không tồn tại.
- `cancelled`: người dùng đã dừng.

Timeout mặc định **5.000 ms mỗi truy vấn**, chỉnh được **100–30.000 ms**. Chuỗi alias có nhiều truy vấn nối tiếp nên tổng lượt đo có thể lâu hơn giá trị này. Đây là truy vấn DNS trực tiếp tới resolver, không đọc file hosts như phân giải tên của hệ điều hành.

Resolver tùy chỉnh chỉ áp dụng cho chế độ **DNS records**; **HTTP / WAF** phân giải tên bằng hệ điều hành của máy chạy extension.

## 3. HTTP / WAF — đo chậm và timeout

### Chạy nhanh

1. Chọn **HTTP / WAF**, nhập đúng URL/path khách hàng báo chậm.
2. Giữ **GET**, **3 mẫu**, nghỉ **500 ms** để thử lần đầu.
3. Nếu endpoint yêu cầu xác thực, mở **Headers và request body**. Headers là JSON object, ví dụ `{"Accept":"application/json","Authorization":"Bearer ..."}`.
4. Bấm **Đo HTTP / WAF**. Kết quả từng mẫu xuất hiện ngay khi mẫu kết thúc.
5. Xem thống kê, timeline, HTTP status và **Tại** nếu mẫu lỗi. Bấm **Dừng** để ngắt request hiện tại và bỏ các mẫu chưa chạy.

Hỗ trợ **GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS**. GET/HEAD không nhận body. POST/PUT/PATCH/DELETE là request thật và được lặp theo số mẫu; thêm origin sẽ gửi cả hai đường, có thể thay đổi dữ liệu endpoint.

### Đọc timeline

`DNS → TCP → TLS (HTTPS) → Gửi request → Chờ headers → Tải body`

Các mốc thuộc **cùng một request**. Mỗi mẫu mở kết nối mới, không tái sử dụng keep-alive; không theo redirect. TLS xác minh chuỗi chứng chỉ và hostname. DNS có thể không xuất hiện khi kết nối trực tiếp IP/origin.

Đây là HTTP client thuần, không chạy JavaScript như trình duyệt và không tự vượt qua bot challenge; phản hồi challenge có thể khác trải nghiệm trên trình duyệt thật.

**Nhận headers sau** là thời gian từ lúc bắt đầu đến lúc Node nhận và phân tích xong response headers, không phải thời điểm byte đầu chính xác. **Chờ headers** là phần chờ sau khi gửi request. Thời gian đó gồm mạng, WAF và backend; chưa tách được riêng từng hệ thống. **Tổng** tính đến tải xong body hoặc đến khi lỗi/timeout/dừng/chạm giới hạn. Byte được đếm trước giải nén; response body không được giữ trong báo cáo.

Nếu chỉ có headers rồi body bị đứng, tool vẫn báo timeout/lỗi ở **Tải body** và giữ số byte đã nhận. Một status 200 không đảm bảo mẫu đã tải xong. Stage chưa hoàn tất được ghi rõ trong timeline.

### Chỉnh timeout và giới hạn

Mở **Ngưỡng timeout và giới hạn tải**:

| Trường | Mặc định | Ý nghĩa |
|---|---:|---|
| DNS | 5.000 ms | Chờ phân giải hostname của request |
| Kết nối TCP | 8.000 ms | Chờ thiết lập kết nối |
| Bắt tay TLS | 8.000 ms | Chờ HTTPS handshake |
| Chờ headers | 30.000 ms | Chờ response headers sau khi gửi request |
| Chờ body | 10.000 ms | Khoảng im lặng tối đa giữa các chunk body |
| Tổng request | 60.000 ms | Deadline cứng từ đầu request; dữ liệu nhỏ giọt không kéo dài được |
| Giới hạn body | 2.097.152 byte | Ngắt khi nhận quá giới hạn, đánh dấu chưa hoàn tất |

Mỗi timeout chỉnh được **100–300.000 ms**. Giai đoạn gửi request cũng bị giới hạn bởi deadline tổng. Body tối đa cấu hình **1.024–10.485.760 byte**. Request body tối đa **64 KiB**; headers tối đa **64 trường / 16 KiB**. Host, Content-Length, Connection và request ID do tool quản lý.

Chạy lặp **1–50 mẫu mỗi đường**, nghỉ **100–60.000 ms** giữa các vòng. Có thể dùng 10–20 mẫu trên endpoint kiểm tra phù hợp để tìm lỗi ngắt quãng; đây chưa phải phép thử tải hay số liệu đại diện lưu lượng production.

### Thống kê có nghĩa gì?

- **Đã thử**: số request thực sự bắt đầu trên đường đó; không tính mẫu chưa chạy sau khi dừng.
- **Hoàn tất**: nhận xong response, kể cả status 4xx/5xx.
- **Timeout máy đo / tỷ lệ timeout**: số mẫu bị deadline của tool ngắt chia cho **Đã thử**; mẫu lỗi và đã dừng vẫn nằm trong mẫu số.
- **HTTP 408/504**: response báo timeout từ server, được đếm riêng; không tự cộng vào timeout máy đo.
- **p50/p95/p99**: chỉ dùng thời gian của mẫu tải hoàn tất, theo nearest rank; loại mẫu timeout, lỗi, dừng, vượt giới hạn body. Ít mẫu thì p95/p99 thường bằng giá trị lớn nhất và chưa đáng để suy ra SLA.
- **Lỗi đo**: lỗi kết nối/stream hoặc chạm giới hạn body. **Đã dừng** được thống kê riêng.

Ví dụ: đặt tổng 8 giây và bị ngắt chỉ chứng minh request chưa hoàn tất trong 8 giây chờ đó. Nó không chứng minh WAF có cấu hình timeout 8 giây.

## 4. Khoanh vùng hệ thống sau Cloudrity/WAF

Giả sử `https://customer.example/api/health` phản hồi chậm:

1. Dùng **DNS records** để xác nhận domain/alias/IP có trỏ đúng hệ thống dự kiến.
2. Dùng **HTTP / WAF** đo đúng request. TCP/TLS nhanh nhưng chờ headers lâu: cần đối chiếu log WAF/backend. Headers nhanh nhưng body bị đứng: xem stage tải body và lỗi stream.
3. Nếu cần so sánh từ các ISP, dùng **Kết nối đa ISP** ở phần sau. Các tùy chọn POST/headers/body/timeline mới chỉ áp dụng phép đo local, không gửi sang probe Globalping.
4. Nếu truy cập được backend, mở **So sánh trực tiếp origin**, nhập **IP origin** và cổng nếu khác URL. Tool kết nối IP đó nhưng giữ **Host/SNI của URL**, vẫn kiểm tra chứng chỉ cho domain gốc.
5. Dùng request ID trong kết quả để tìm log tương ứng; nhập log theo phần tiếp theo nếu có.

Đường public là **client → URL công khai/WAF**; đường origin là **client → origin**, chạy tuần tự và độc lập. **Không lấy chênh lệch hai đường làm thời gian xử lý WAF**, vì đường mạng và thời điểm đo khác nhau. Origin có ACL chỉ cho WAF truy cập có thể không đo trực tiếp được từ máy bạn.

Dù bạn vận hành Cloudrity/WAF, tool bên ngoài vẫn không tự thấy được chặng **WAF → backend → ứng dụng/database**. Để phân biệt chính xác cần timing/log tại WAF và có thể cả trace ứng dụng. Traceroute chỉ cho đường mạng tới IP đích, không trace các bước xử lý bên trong WAF.

## 5. Ghép log WAF theo request ID

Mỗi request có UUID riêng, gửi qua header **`x-diagnostic-request-id`** và hiển thị trong kết quả. Cấu hình hệ thống WAF của bạn ghi header này vào log. Tool chưa tự kết nối API hoặc đọc log trực tiếp của Cloudrity/vendor nào.

Chọn kết quả HTTP đã hoàn tất → **Nhập log WAF** → chọn `.json`, `.jsonl` hoặc `.ndjson`. Nhận một object, mảng object hoặc mỗi dòng một JSON object:

```json
[
  {
    "requestId": "UUID-thực-tế-trong-kết-quả",
    "requestTimeMs": 1230,
    "upstreamConnectMs": 12,
    "upstreamHeaderMs": 1100,
    "upstreamResponseMs": 1200,
    "status": 200,
    "upstreamStatus": 200
  }
]
```

`requestId` bắt buộc, tối đa 256 ký tự. Cần ít nhất một trường timing hoặc status. Các timing là **số millisecond không âm**, không nhận chuỗi hoặc tự đoán đơn vị: nếu log gốc dùng giây, chuyển sang ms trước. `status`/`upstreamStatus` là số nguyên 100–599. Các trường khác bị bỏ qua. Tối đa **2 MiB / 10.000 bản ghi**.

Tool đối chiếu ID mình gửi và response header `x-request-id`/`x-correlation-id`. ID xuất hiện ở nhiều mẫu bị coi là mơ hồ và không được gán timing. Nhiều bản ghi cùng khớp một mẫu được giữ lại. Xem số **Khớp / Không khớp** và phần log chi tiết.

Các số này là **dữ liệu log do bạn cung cấp**, không phải tool tự đo đường WAF → origin. Không cộng/trừ các timing upstream nếu chưa biết định nghĩa log của WAF; một số mốc có thể đã bao gồm nhau.

## 6. Kết nối đa ISP — kiểm tra thông mạng và traceroute

1. Chọn **Kết nối đa ISP**. Lần đầu giữ **Local**, bỏ **Remote probes**.
2. Chọn DNS, Ping, HTTP/TLS; bật **Traceroute** khi cần xem đường đi.
3. Bấm **Kiểm tra kết nối**, xem trạng thái từng phép đo và **Diagnosis**.
4. Để so sánh mạng, bật Remote probes và nhập tên mạng mỗi dòng hoặc cách bằng dấu phẩy, tối đa **8 mạng**. Mặc định VN + Viettel/FPT/VNPT/MobiFone.

Chế độ này có DNS A/AAAA, TCP, TLS/chứng chỉ, HTTP GET, Ping và Traceroute. Remote dùng Globalping và cố gắng giữ cùng probe cho các phép đo của một mạng. Xem mạng thực tế, ASN, vị trí và **Raw output / Structured data**.

**Khác biệt quan trọng:** HTTP local trong chế độ này chỉ đo đến response headers, còn DNS/TCP/TLS là các phép thử độc lập. Không cộng/trừ các thời gian đó thành timeline một request. Muốn đo toàn bộ body, timeout theo giai đoạn và nhiều mẫu thì dùng **HTTP / WAF**. Chế độ đa ISP chưa hỗ trợ dừng giữa chừng.

Ping lỗi có thể do ICMP bị lọc. Traceroute có dấu `*` chưa chứng minh mất đường. HTTP 403/404 chứng minh đã nhận HTTP dù request bị từ chối/path không đúng. 408/504 cần đối chiếu log; 429 là tín hiệu giới hạn request. Trong chế độ đa ISP, dấu xanh không đồng nghĩa nội dung HTTP thành công: cần đọc status cụ thể.

Remote cần kết nối Globalping và probe online. **No matching online probe**, lỗi API hoặc hết hạn mức không chứng minh ISP mất kết nối. Một probe không đại diện mọi thuê bao/đường FTTH/4G/5G của nhà mạng. Timeout gọi API Globalping khác timeout probe → website.

## 7. Lịch sử, copy và export

- **Lịch sử phiên** giữ tối đa **10 lượt** trong bộ nhớ extension host. Chọn một lượt để xem lại; đóng/reload extension host sẽ mất lịch sử. Không tự ghi báo cáo ra đĩa.
- **Copy JSON** sao chép kết quả đang chọn. **Export JSON** cho chọn nơi lưu file. **Nhập log WAF** chỉ bật khi chọn kết quả HTTP / WAF.
- **Xóa kết quả** xóa phần hiển thị, không xóa lịch sử đã lưu.
- Request headers/body không được đưa vào lịch sử hoặc báo cáo và không lưu bằng webview state. Giá trị query trong các trường URL báo cáo được che; request thật vẫn dùng query đầy đủ. Báo cáo vẫn có hostname/path, IP, request ID và một số response headers; kiểm tra nội dung trước khi chia sẻ, nhất là dữ liệu phản hồi/log do server tự đưa vào.

## 8. Cấu hình và lỗi thường gặp

Settings → tìm **Multi-ISP Domain Checker**:

| Cấu hình | Áp dụng |
|---|---|
| `multiIspChecker.country` | Quốc gia lọc Globalping, mặc định VN |
| `multiIspChecker.remoteNetworks` | Danh sách mạng mặc định |
| `multiIspChecker.timeoutMs` | Timeout local của **Kết nối đa ISP**, mặc định 8.000 ms, khoảng 1.000–30.000; không đổi timeout của HTTP / WAF mới |
| `multiIspChecker.globalpingToken` | Token tùy chọn; biến môi trường `GLOBALPING_TOKEN` của tiến trình VS Code được ưu tiên |

Mở lại Extension Development Host sau khi đổi danh sách/quốc gia mặc định.

| Tình huống | Cách xử lý |
|---|---|
| F5 không thấy tool | Mở đúng thư mục, chọn Run Multi-ISP Checker; tìm sidebar trong cửa sổ Extension Development Host |
| PowerShell chặn npm.ps1 | Dùng `npm.cmd run compile` / `npm.cmd test` |
| DNS no-data | Thử loại record phù hợp; khác với tên không tồn tại |
| DNS timeout/error | Kiểm tra resolver/IP/cổng, mạng/VPN; thử resolver khác nếu phù hợp |
| TLS lỗi chứng chỉ | Kiểm tra domain, SNI, chuỗi CA và hạn chứng chỉ; tool không bỏ xác minh TLS |
| Chạm giới hạn body | Tăng giới hạn trong HTTP / WAF nếu muốn đo tải đầy đủ |
| Remote không có probe / 429 | Đổi mạng/thử lại sau; giảm số phép đo hoặc dùng token phù hợp |
| Không tìm thấy ping/traceroute | Cài lệnh trên máy/container chạy extension hoặc bỏ phép đo đó |
| Không ghép được log | Dùng UUID thật, kiểm tra header WAF ghi, đơn vị ms và ID có bị dùng lại không |

Chưa có live log connector riêng cho Cloudrity, distributed tracing, đo tải đồng thời, DNS zone enumeration hoặc timeline HTTP tùy chỉnh từ Globalping. Các chức năng hiện có phục vụ khoanh vùng và đối chiếu bằng chứng, không tự khẳng định nguyên nhân nội bộ WAF/backend.

## 9. Kiểm tra branch và cập nhật lên GitHub

Thư mục local không tự “ở trên” GitHub; nó có một branch local và có thể liên kết với một branch remote. Mở Terminal/PowerShell tại thư mục dự án rồi chạy:

```powershell
git status -sb
git branch --show-current
git branch -vv
git remote -v
```

Ý nghĩa:

- `git branch --show-current`: tên branch local hiện tại.
- `git branch -vv`: branch đang theo dõi branch nào trên remote và đang đi trước/đi sau bao nhiêu commit.
- `git remote -v`: địa chỉ repository GitHub (thường là remote `origin`).
- `git status -sb`: trạng thái file và dòng đầu như `## main...origin/main`.

Để xem branch trên GitHub có commit mới hay không mà chưa thay đổi file local:

```powershell
git fetch origin
git status -sb
```

Nếu working tree sạch và muốn lấy cập nhật mới nhất từ branch đang theo dõi:

```powershell
git pull --rebase
```

Nếu có file đang sửa, hãy kiểm tra `git status` và lưu lại bằng commit hoặc `git stash` trước khi pull. Không dùng `git reset --hard` nếu chưa chắc vì lệnh đó có thể xóa thay đổi local.

### Đẩy thay đổi local lên GitHub

1. Xem lại file sẽ đưa vào commit:

   ```powershell
   git status
   git diff
   ```

2. Chọn file liên quan và tạo commit. Nếu muốn cập nhật toàn bộ thay đổi hiện tại, dùng `git add -A`:

   ```powershell
   git add -A
   git commit -m "Describe the change"
   ```

3. Lấy thay đổi mới từ GitHub và đặt commit local lên trên:

   ```powershell
   git pull --rebase
   ```

4. Đẩy branch hiện tại lên GitHub:

   ```powershell
   git push
   ```

   Với branch mới chưa có upstream, dùng một lần:

   ```powershell
   git push -u origin ten-branch
   ```

Nếu xảy ra conflict khi `pull --rebase`, sửa các file có dấu conflict, sau đó chạy `git add <file>` và `git rebase --continue`. Nếu muốn hủy quá trình rebase, chạy `git rebase --abort`; chỉ sau khi kiểm tra lại trạng thái mới tiếp tục.

Repository hiện tại dùng remote `origin` trỏ tới `alec-Ng196/Multi-ISP-connection-checker`; branch mặc định local là `main` và đang theo dõi `origin/main`.
