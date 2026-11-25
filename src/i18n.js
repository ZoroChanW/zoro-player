/* Zoro Player — i18n (fa / en). Persian source strings are the keys.
   T(key, vars)  -> translated string for JS-built text ({x} placeholders)
   DOM translator -> static markup / any text node or title|placeholder|data-title attribute whose text is a key.
   Mark a subtree with data-no-i18n to leave it untouched (user data: titles, paths, names). */
(() => {
'use strict';
const norm = s => String(s).replace(/[‌‏‎]/g, '').replace(/\s+/g, ' ').trim();
const EN_RAW = {
  /* titlebar / window */
  'کتابخانه': 'Library', 'ویجت': 'Widget', 'اکولایزر': 'Equalizer', 'ظاهر': 'Theme',
  'کتابخانه (L)': 'Library (L)', 'ویجت دسکتاپ': 'Desktop widget', 'اکولایزر (E)': 'Equalizer (E)', 'ظاهر و شخصی‌سازی': 'Appearance & customization',
  'کوچک‌کردن': 'Minimize', 'بزرگ‌کردن': 'Maximize', 'بستن': 'Close', 'زبان': 'Language',
  /* left panel */
  'آهنگ‌ها': 'Tracks', 'پلی‌لیست': 'Playlists', 'پوشه‌ها': 'Folders',
  'جستجوی آهنگ، هنرمند، آلبوم…': 'Search title, artist, album…', 'مرتب‌سازی': 'Sort',
  'ترتیب پوشه': 'Folder order', 'عنوان': 'Title', 'هنرمند': 'Artist', 'مدت': 'Duration', 'آلبوم': 'Album',
  'هنوز آهنگی اضافه نشده': 'No tracks yet',
  'پوشهٔ آهنگ‌هات رو انتخاب کن تا همهٔ آهنگ‌های داخلش، با زیرپوشه‌ها، اضافه بشن.': 'Pick your music folder and every track inside it, subfolders included, will be added.',
  'افزودن پوشه': 'Add folder', 'افزودن فایل': 'Add files', 'اسکن مجدد': 'Rescan',
  'در حال اسکن آهنگ‌ها…': 'Scanning tracks…',
  '+ پلی‌لیست جدید': '+ New playlist',
  'هنوز پلی‌لیستی نساختی. روی هر آهنگ راست‌کلیک کن و «افزودن به پلی‌لیست» رو بزن، یا از بخش کتابخانه چند آهنگ رو با هم انتخاب کن.': 'No playlists yet. Right-click any track and choose “Add to playlist”, or select several tracks in the Library.',
  'می‌تونی پوشه یا فایل رو از اکسپلورر بکشی و روی پنجره رها کنی. روی هر پوشه راست‌کلیک کن تا گزینه‌هاش رو ببینی. فرمت‌های پشتیبانی‌شده: MP3، FLAC، WAV، OGG، Opus، M4A، AAC.': 'Drag folders or files from Explorer onto the window. Right-click a folder for more options. Supported: MP3, FLAC, WAV, OGG, Opus, M4A, AAC.',
  'در حال پخش': 'Now playing', 'آمادهٔ پخش': 'Ready to play', 'یه پوشه اضافه کن و از آهنگ‌هات لذت ببر': 'Add a folder and enjoy your music', 'هنرمند نامشخص': 'Unknown artist',
  'پوشه یا آهنگ‌ها رو اینجا رها کن': 'Drop folders or tracks here',
  /* eq */
  'فعال': 'On', 'محافظ صدا (جلوگیری از اعوجاج)': 'Limiter (prevents distortion)', 'نام پیش‌تنظیم من…': 'My preset name…',
  'ذخیره': 'Save', 'بازنشانی': 'Reset', 'پری‌امپ': 'Preamp',
  'فلت': 'Flat', 'بیس قوی': 'Bass boost', 'تربل': 'Treble', 'ووکال': 'Vocal', 'راک': 'Rock', 'پاپ': 'Pop', 'جاز': 'Jazz', 'کلاسیک': 'Classical', 'الکترونیک': 'Electronic', 'هیپ‌هاپ': 'Hip-hop', 'کم‌کردن بیس': 'Bass reduce',
  /* appearance */
  'پوسته‌های آماده': 'Presets', 'پس‌زمینه': 'Background', 'کاور محو': 'Blurred cover', 'شفق متحرک': 'Aurora', 'تصویر دلخواه': 'Custom image', 'گرادیان': 'Gradient', 'رنگ ساده': 'Solid',
  'میزان محوشدن': 'Blur', 'روشنایی': 'Brightness', 'تصویر پس‌زمینه': 'Background image', 'انتخاب تصویر…': 'Choose image…', 'حذف': 'Remove',
  'رنگ‌های گرادیان': 'Gradient colors', 'زاویه': 'Angle', 'رنگ': 'Color', 'کاور و پس‌زمینه سیاه‌وسفید': 'Grayscale cover & background', 'تیرگی حاشیه‌ها': 'Vignette',
  'رنگ تأکیدی': 'Accent color', 'رنگ از کاور': 'From cover', 'انتخاب دستی': 'Manual',
  'شیشه و گوشه‌ها': 'Glass & corners', 'شفافیت پنل‌ها': 'Panel opacity', 'گردی گوشه‌ها': 'Corner radius', 'اندازهٔ نوشته‌ها': 'Text size',
  'ویژوالایزر': 'Visualizer', 'بلوکی': 'Blocks', 'میله‌ای': 'Bars', 'آینه‌ای': 'Mirror', 'موج': 'Wave', 'دایره‌ای': 'Circle', 'خاموش': 'Off', 'رنگین‌کمان': 'Rainbow',
  '۳۲ میله': '32 bars', '۴۸ میله': '48 bars', '۶۴ میله': '64 bars', '۹۶ میله': '96 bars', 'حساسیت': 'Sensitivity',
  'کاور': 'Cover', 'مربع': 'Square', 'صفحهٔ گرامافون': 'Vinyl', 'اندازه': 'Size',
  'ویجت دسکتاپ ': 'Desktop widget', 'با باز شدن برنامه، ویجت هم باز بشه': 'Open the widget when the app starts', 'ویجت همیشه روی پنجره‌ها بمونه': 'Keep widget above other windows', 'شفافیت ویجت': 'Widget opacity',
  'برداشتن از علاقه‌مندی‌ها': 'Remove from favorites',
  'افزودن به علاقه‌مندی‌ها ♥': 'Add to favorites ♥',
  'امتیاز': 'Rating',
  'بدون امتیاز': 'No rating',
  'به علاقه‌مندی‌ها اضافه شد': 'Added to favorites',
  'از علاقه‌مندی‌ها برداشته شد': 'Removed from favorites',
  'علاقه‌مندی‌ها': 'Favorites',
  'پرتکرارترین‌ها': 'Most played',
  'اخیراً پخش‌شده': 'Recently played',
  'اخیراً اضافه‌شده': 'Recently added',
  'امتیاز بالا (۴ و ۵ ستاره)': 'Top rated (4–5 stars)',
  '+ هوشمند': '+ Smart',
  '+ پلی‌لیست هوشمند': '+ Smart playlist',
  'آمار': 'Stats',
  'ویرایش شرط‌ها': 'Edit rules',
  'ویرایش شرط‌ها…': 'Edit rules…',
  'ساخت پلی‌لیست هوشمند از روی این…': 'New smart playlist from this…',
  'بیشترین پخش': 'Most played',
  'آخرین پخش': 'Last played',
  'تازه‌ترین اضافه‌شده': 'Newest added',
  'سال انتشار': 'Year',
  'ویرایش پلی‌لیست هوشمند': 'Edit smart playlist',
  'پلی‌لیست هوشمند جدید': 'New smart playlist',
  'آهنگ‌هایی که': 'Tracks that match',
  'همهٔ شرط‌ها': 'all conditions',
  'حداقل یکی از شرط‌ها': 'at least one condition',
  '+ شرط جدید': '+ Add condition',
  'حداکثر تعداد': 'Max items',
  'نامحدود': 'Unlimited',
  'بله': 'Yes',
  'خیر': 'No',
  'الان {n} آهنگ با این شرط‌ها می‌خونه': '{n} tracks match right now',
  'ذخیره شد': 'Saved',
  'مسیر فایل': 'File path',
  'امتیاز (۰ تا ۵)': 'Rating (0–5)',
  'تعداد پخش': 'Play count',
  'مدت (دقیقه)': 'Duration (min)',
  'چند روز پیش اضافه شده': 'Days since added',
  'چند روز پیش پخش شده': 'Days since last played',
  'علاقه‌مندی': 'Favorite',
  'شامل': 'contains',
  'شامل نیست': 'doesn\'t contain',
  'دقیقاً برابر': 'is exactly',
  'حداقل': 'at least',
  'حداکثر': 'at most',
  'دقیقاً': 'exactly',
  'هست': 'is',
  'تاریخ اضافه‌شدن': 'Date added',
  'فعلاً هیچ آهنگی با این شرط‌ها نمی‌خونه. با گوش دادن، علاقه‌مندی و امتیاز دادن این لیست پر می‌شه.': 'No tracks match these rules yet. Listening, favoriting and rating will fill this list.',
  '{n} ساعت': '{n} h',
  '{n} دقیقه': '{n} min',
  'کل دفعات پخش': 'Total plays',
  'زمان گوش‌دادن': 'Listening time',
  'آهنگ‌های شنیده‌شده': 'Tracks played',
  'امتیازدار': 'Rated',
  'پرتکرارترین آهنگ‌ها': 'Top tracks',
  'پرتکرارترین هنرمندها': 'Top artists',
  'هنوز آماری ثبت نشده. هر آهنگی که حداقل ۳۰ ثانیه (یا نصفش) گوش بدی یک بار شمرده می‌شه.': 'No stats yet. A track counts as played after 30 s (or half of a short track).',
  'پاک‌کردن همهٔ آمار، علاقه‌مندی‌ها و امتیازها': 'Clear all stats, favorites and ratings',
  'پاک‌کردن آمار': 'Clear stats',
  'آمار پخش، علاقه‌مندی‌ها و امتیازها پاک بشن؟ این کار برگشت‌پذیر نیست.': 'Clear play stats, favorites and ratings? This can\'t be undone.',
  'پاک کن': 'Clear',
  'آمار پاک شد': 'Stats cleared',
  'عمومی': 'General', 'پخش بدون وقفه بین آهنگ‌ها (Gapless)': 'Gapless playback between tracks', 'کراس‌فید بین آهنگ‌ها (۰ = خاموش)': 'Crossfade between tracks (0 = off)', 'ادامهٔ آخرین آهنگ هنگام باز شدن برنامه': 'Resume last track on startup', 'بازنشانی همهٔ تنظیمات ظاهر': 'Reset all appearance settings',
  'Mono + کاور': 'Mono + cover',
  'با بستن پنجره، برنامه به ترای بره (بسته نشه)': 'Closing the window keeps the app running in the tray', 'نمایش Zoro Player': 'Show Zoro Player', 'خروج': 'Quit',
  'پوشه‌ها رو زیر نظر بگیر و آهنگ‌های جدید رو خودکار اضافه کن': 'Watch folders and add new tracks automatically', '{n} آهنگ جدید پیدا شد': '{n} new tracks found', '{n} آهنگ از پوشه‌ها حذف شده بود': '{n} tracks removed (deleted from disk)',
  'صف': 'Queue', 'صف پخش': 'Play queue', 'صف پخش (Q)': 'Play queue (Q)', 'بُر زدن بعدی‌ها': 'Shuffle upcoming', 'پاک‌کردن بعدی‌ها': 'Clear upcoming',
  'صف خالیه. یه آهنگ پخش کن یا با راست‌کلیک «افزودن به صف» رو بزن.': 'The queue is empty. Play a track or right-click → “Add to queue”.',
  '{n} آهنگ بعدی': '{n} up next', '{n} آهنگ قبلی…': '{n} earlier…', '+ {n} آهنگ دیگه…': '+ {n} more…', 'حذف از صف': 'Remove from queue',
  'برای پخش این فرمت (WMA / APE / WavPack…) فایل ffmpeg.exe لازمه؛ کنار برنامه بذارش.': 'Playing this format (WMA / APE / WavPack…) needs ffmpeg.exe — put it next to the app.',
  'تکرار': 'Repeat', 'قطع اتصال': 'Disconnect', 'اتصال به Spotify': 'Connect to Spotify',
  'پخش از خود اپ Spotify انجام می‌شه (اکولایزر و ویژوالایزر روش اثر نداره)؛ این‌جا فقط کنترل، جستجو و پلی‌لیست‌هاته. برای کنترل پخش، حساب Premium لازمه.': 'Playback happens in the Spotify app (the equalizer and visualizer don’t apply). This panel is only for control, search and your playlists. Controlling playback requires a Premium account.',
  'توی': 'At', 'یه اپ بساز (گزینهٔ Web API).': 'create an app (choose Web API).',
  'این آدرس رو دقیقاً توی Redirect URIs اپ اضافه کن:': 'Add this exact address to the app’s Redirect URIs:', 'کپی': 'Copy',
  'Client ID اپ رو این‌جا بچسبون و وصل شو:': 'Paste the app’s Client ID here and connect:', 'اتصال': 'Connect',
  'پخش تصادفی': 'Shuffle play', 'به‌روزرسانی دستگاه‌ها': 'Refresh devices', 'جستجو': 'Search', 'جستجوی آهنگ…': 'Search tracks…', '← بازگشت': '← Back',
  'Client ID باید یه رشتهٔ ۳۲ کاراکتری باشه (از داشبورد Spotify کپی کن).': 'The Client ID must be a 32-character string (copy it from the Spotify dashboard).',
  'مرورگر باز شد؛ ورود رو تأیید کن…': 'Your browser opened — approve the login…', 'اتصال انجام نشد: {e}': 'Connection failed: {e}', 'اتصال Spotify قطع شد': 'Spotify disconnected',
  'دستگاه فعالی پیدا نشد. اپ Spotify رو باز کن (یا یه دستگاه از لیست انتخاب کن).': 'No active device found. Open the Spotify app (or pick a device from the list).',
  'این کار به حساب Premium نیاز داره (یا مجاز نیست).': 'This needs a Premium account (or isn’t allowed).',
  'چیزی در حال پخش نیست': 'Nothing is playing', 'هیچ دستگاهی پیدا نشد': 'No devices found', 'بیشتر…': 'More…',
  'اسم آهنگ یا هنرمند رو بنویس…': 'Type a track or artist name…', 'پلی‌لیستی پیدا نشد.': 'No playlists found.',
  'این پلی‌لیست آهنگی نداره (یا فقط برای صاحبش قابل‌مشاهده‌ست).': 'This playlist has no tracks (or is only visible to its owner).',
  'به صف Spotify اضافه شد': 'Added to the Spotify queue', 'کپی شد': 'Copied',
  'این حساب اجازهٔ استفاده از اپ رو نداره؛ صاحب اپ باید Premium داشته باشه و حساب رو به اپ اضافه کرده باشه.': 'This account isn’t allowed to use the app: the app owner needs Premium and must have added this account to the app.',
  'تغییر عکس…': 'Set cover image…', 'حذف عکس': 'Remove image', 'عکس پلی‌لیست': 'Playlist image',
  /* library sheet */
  'پخش': 'Play', 'افزودن به پلی‌لیست': 'Add to playlist', 'حذف از پلی‌لیست': 'Remove from playlist', 'حذف از برنامه': 'Remove from app', 'لغو انتخاب': 'Clear selection',
  'جستجو در آهنگ، هنرمند، آلبوم…': 'Search title, artist, album…', 'شبکه': 'Grid', 'لیست': 'List', 'پلی‌لیست‌ها': 'Playlists',
  'بازگشت': 'Back', 'تصادفی': 'Shuffle', 'تغییر نام': 'Rename', 'حذف پلی‌لیست': 'Delete playlist',
  'قبلی': 'Previous', 'بعدی': 'Next', 'پخش / توقف': 'Play / pause', 'پخش / توقف (Space)': 'Play / pause (Space)', 'بی‌صدا (M)': 'Mute (M)', 'پخش تصادفی (S)': 'Shuffle (S)', 'تکرار (R)': 'Repeat (R)', 'سرعت پخش': 'Playback speed', 'تغییر حالت ویژوالایزر (V)': 'Change visualizer (V)',
  'همیشه روی بقیه پنجره‌ها': 'Always on top', 'بستن ویجت': 'Close widget', 'حذف از برنامه ': 'Remove from app', 'حذف همه': 'Remove all',
  'فایل‌های جداگانه': 'Individual files', 'هنوز پوشه‌ای اضافه نکردی.': 'No folders added yet.',
  /* dynamic (T) — app.js */
  '{n} آهنگ': '{n} tracks', '{n} فایل': '{n} files',
  'پلی‌لیست «{name}» — {n} آهنگ': 'Playlist “{name}” — {n} tracks', 'فقط «{name}» — {n} آهنگ': 'Only “{name}” — {n} tracks',
  'خطا در اسکن آهنگ‌ها: {e}': 'Scan error: {e}', '{n} آهنگ از «{name}» اضافه شد': '{n} tracks added from “{name}”',
  'توی این پوشه آهنگ قابل‌پخشی پیدا نشد': 'No playable tracks found in this folder', '{n} فایل اضافه شد': '{n} files added',
  'چیز جدیدی برای اضافه‌کردن پیدا نشد': 'Nothing new to add', 'اضافه شد ✓': 'Added ✓',
  'پخش این آهنگ ممکن نشد: {name}': 'Could not play: {name}', 'اول یه پوشه آهنگ اضافه کن': 'Add a music folder first',
  'همین آهنگ در حال پخشه': 'This track is already playing', 'بعد از آهنگ فعلی پخش می‌شه': 'Plays after the current track', 'به انتهای صف اضافه شد': 'Added to the end of the queue',
  'باز کردن ویجت ممکن نشد: {e}': 'Could not open the widget: {e}', 'تصویر برای ذخیره‌شدن زیادی بزرگه': 'Image is too large to save', 'این تصویر قابل‌باز شدن نبود': 'Could not open this image',
  'تنظیمات ظاهر بازنشانی شد': 'Appearance settings reset', '{n} آهنگ در کتابخانه است': '{n} tracks in the library', 'فقط آهنگ‌های این پوشه نمایش داده می‌شن': 'Showing only tracks from this folder',
  'یه اسم برای پیش‌تنظیم بنویس': 'Enter a name for the preset', '«{name}» ذخیره شد': '“{name}” saved', 'این فایل قابل‌پخش نیست': 'This file can’t be played',
  'خطا: {e}': 'Error: {e}', 'خطا در راه‌اندازی: {e}': 'Startup error: {e}',
  /* features.js */
  'این پلی‌لیست آهنگ قابل‌پخشی نداره': 'This playlist has no playable tracks', 'پلی‌لیست جدید': 'New playlist', 'نام پلی‌لیست': 'Playlist name', 'ساختن': 'Create',
  '«{name}» ساخته شد': '“{name}” created', '«{name}» ساخته شد و {n} آهنگ اضافه شد': '“{name}” created with {n} tracks',
  'تغییر نام پلی‌لیست': 'Rename playlist', 'حذف پلی‌لیست ': 'Delete playlist',
  'پلی‌لیست «{name}» حذف بشه؟ آهنگ‌ها و فایل‌ها دست‌نخورده می‌مونن.': 'Delete playlist “{name}”? The tracks and files stay untouched.', 'پلی‌لیست حذف شد': 'Playlist deleted',
  'تأیید': 'OK', 'انصراف': 'Cancel',
  'خواندن اطلاعات ممکن نشد: {e}': 'Could not read info: {e}', 'خواندن تصویر ممکن نشد: {e}': 'Could not read image: {e}',
  'مونو': 'Mono', 'استریو': 'Stereo', 'هنرمند آلبوم': 'Album artist', 'ژانر': 'Genre', 'سال': 'Year', 'شمارهٔ ترک': 'Track number', 'توضیح': 'Comment',
  'فرمت': 'Format', 'بیت‌ریت': 'Bitrate', 'نرخ نمونه': 'Sample rate', 'کانال': 'Channels', 'حجم': 'Size', 'آخرین تغییر': 'Modified', 'نام فایل': 'File name', 'مسیر': 'Path',
  'اطلاعات آهنگ': 'Track info', 'ویرایش نام و تگ‌ها…': 'Edit name & tags…', 'ویرایش نام و تگ‌ها': 'Edit name & tags', 'باز کردن محل فایل': 'Show in folder',
  'تغییر کاور…': 'Change cover…', 'حذف کاور': 'Remove cover',
  'این فایل فقط‌خواندنیه؛ احتمالاً ذخیرهٔ تگ‌ها ممکن نیست.': 'This file is read-only; saving tags will probably fail.',
  'فرمت WAV از کاور و هنرمند آلبوم داخل فایل پشتیبانی نمی‌کنه.': 'WAV doesn’t support embedded covers or album artist.',
  'سال یا شمارهٔ ترک معتبر نیست': 'Year or track number is invalid', 'نام فایل نباید خالی باشد': 'File name can’t be empty', 'تغییرات ذخیره شد': 'Changes saved',
  'حذف از برنامه ': 'Remove from app',
  '{n} آهنگ از برنامه حذف بشن؟ فایل‌ها روی دیسک دست‌نخورده می‌مونن و از تب «پوشه‌ها» می‌تونی برشون گردونی.': 'Remove {n} tracks from the app? Files on disk stay untouched and you can restore them from the “Folders” tab.',
  '{n} آهنگ از برنامه حذف شد': '{n} tracks removed from the app', 'آهنگ از برنامه حذف شد (فایل روی دیسک می‌مونه)': 'Track removed from the app (the file stays on disk)',
  'حذف': 'Remove',
  'پخش انتخاب‌شده‌ها ({n})': 'Play selected ({n})', 'پخش بعدی': 'Play next', 'افزودن به صف': 'Add to queue',
  '{n} آهنگ به «{name}» اضافه شد': '{n} tracks added to “{name}”', 'همه از قبل توی این پلی‌لیست بودن': 'All of them are already in this playlist', '+ پلی‌لیست جدید…': '+ New playlist…',
  'حذف از این پلی‌لیست': 'Remove from this playlist', 'حذف از این پلی‌لیست ({n})': 'Remove from this playlist ({n})', 'انتقال به بالا': 'Move up', 'انتقال به پایین': 'Move down',
  'کپی مسیر فایل': 'Copy file path', 'مسیر کپی شد': 'Path copied', 'کپی ممکن نشد': 'Copy failed', 'حذف از برنامه ({n})': 'Remove from app ({n})',
  'پخش تصادفی': 'Shuffle play', 'باز کردن در کتابخانه': 'Open in library', 'تغییر نام…': 'Rename…', 'ساخت کپی': 'Duplicate', '{name} (کپی)': '{name} (copy)',
  'پاک‌کردن موارد در دسترس‌نبوده ({n})': 'Clear unavailable entries ({n})', '{n} در دسترس نیست': '{n} unavailable',
  'بازگرداندن آهنگ‌های حذف‌شده ({n})': 'Restore removed tracks ({n})', '{n} آهنگ برگردونده شد': '{n} tracks restored',
  'نمایش آهنگ‌های این پوشه': 'Show tracks in this folder', 'باز کردن پوشه در اکسپلورر': 'Open folder in Explorer', 'اسکن دوبارهٔ همه': 'Rescan all', 'حذف پوشه از برنامه': 'Remove folder from app',
  'نتیجه‌ای پیدا نشد.': 'No results.', 'کتابخانه خالیه. از تب «پوشه‌ها» یه پوشه اضافه کن.': 'The library is empty. Add a folder from the “Folders” tab.',
  '{n} پلی‌لیست': '{n} playlists', 'هنوز پلی‌لیستی نساختی.': 'No playlists yet.',
  'این پلی‌لیست خالیه. از بخش «آهنگ‌ها» چند آهنگ رو انتخاب کن و «افزودن به پلی‌لیست» رو بزن.': 'This playlist is empty. Select tracks in “Tracks” and choose “Add to playlist”.',
  '{n} انتخاب شد': '{n} selected',
};
const EN = new Map(Object.entries(EN_RAW).map(([k, v]) => [norm(k), v]));

let lang = 'fa';
try { const s = JSON.parse(localStorage.getItem('zp.lang')); if (s === 'en' || s === 'fa') lang = s; } catch { /* default */ }

function T(key, vars) {
  let s = key;
  if (lang === 'en') { const v = EN.get(norm(key)); if (v !== undefined) s = v; }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

/* ── DOM translator ── */
const ATTRS = ['title', 'placeholder', 'data-title', 'aria-label'];
const tRec = new WeakMap();          // text node -> { src, out }
const aRec = new WeakMap();          // element -> { attr: { src, out } }
const FA_RE = /[؀-ۿ]/;
const skip = n => { const el = n.nodeType === 1 ? n : n.parentElement; return !el || !!el.closest('[data-no-i18n],script,style'); };

function doText(n) {
  if (skip(n)) return;
  const cur = n.data, r = tRec.get(n);
  if (r && cur === r.out) { if (lang === 'fa') { n.data = r.src; tRec.delete(n); } return; }
  if (lang !== 'en' || !FA_RE.test(cur) && !EN.has(norm(cur))) return;
  const v = EN.get(norm(cur)); if (v === undefined) return;
  const out = cur.replace(cur.trim(), v);
  tRec.set(n, { src: cur, out }); n.data = out;
}
function doAttrs(el) {
  if (skip(el)) return;
  let rec = aRec.get(el);
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const cur = el.getAttribute(a), r = rec && rec[a];
    if (r && cur === r.out) { if (lang === 'fa') { el.setAttribute(a, r.src); delete rec[a]; } continue; }
    if (lang !== 'en') continue;
    const v = EN.get(norm(cur)); if (v === undefined) continue;
    if (!rec) { rec = {}; aRec.set(el, rec); }
    rec[a] = { src: cur, out: v }; el.setAttribute(a, v);
  }
}
function walk(root) {
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  if (skip(root)) return;
  doAttrs(root);
  for (let c = root.firstChild; c; c = c.nextSibling) walk(c);
}
let mo = null;
function pauseObs(fn) { if (mo) { mo.disconnect(); } try { fn(); } finally { if (mo) { mo.takeRecords(); observe(); } } }
function observe() { mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
function startObserver() {
  mo = new MutationObserver(list => {
    pauseObs(() => {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach(walk);
        else if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
      }
    });
  });
  observe();
}

function apply() {
  const html = document.documentElement;
  html.lang = lang; html.dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.body.dataset.lang = lang;
  pauseObs(() => walk(document.documentElement));
}
function setLang(l, quiet) {
  if (l !== 'fa' && l !== 'en') return;
  lang = l;
  try { localStorage.setItem('zp.lang', JSON.stringify(l)); } catch { /* ignore */ }
  apply();
  document.dispatchEvent(new CustomEvent('zp:lang', { detail: l }));
  if (!quiet) try { const e = window.__TAURI__ && window.__TAURI__.event; if (e && e.emit) e.emit('zp-lang', l); } catch { /* ignore */ }
}

window.T = T;
window.I18N = { T, get lang() { return lang; }, setLang, apply, has: k => EN.has(norm(k)), norm, keys: () => [...EN.keys()] };

const boot = () => {
  document.documentElement.lang = lang; document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.body.dataset.lang = lang;
  if (lang === 'en') pauseObs(() => walk(document.documentElement));
  startObserver();
  // language switch controls: any [data-lang-set] button; #btnLang toggles
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-lang-set]');
    if (b) setLang(b.dataset.langSet);
    else if (e.target.closest && e.target.closest('#btnLang')) setLang(lang === 'fa' ? 'en' : 'fa');
  });
  syncLangUI();
  document.addEventListener('zp:lang', syncLangUI);
};
function syncLangUI() {
  document.querySelectorAll('[data-lang-set]').forEach(b => b.classList.toggle('on', b.dataset.langSet === lang));
  const bl = document.getElementById('btnLang'); if (bl) { bl.firstElementChild.textContent = lang === 'fa' ? 'EN' : 'فا'; }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
