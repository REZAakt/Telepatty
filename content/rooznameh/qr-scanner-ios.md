---
title: 'چگونه اسکن QR را روی iOS نجات دادیم'
description: 'BarcodeDetector در سافاری وجود ندارد؛ راه‌حل: تشخیص قابلیت getUserMedia + رمزگشای jsQR با بارگذاری تنبل، همراه با پیام‌های خطای دقیق.'
date: 2026-09-20
category: tech
cover: /media/cover-qr.svg
author: 'REZA'
tags: ['iOS', 'Safari', 'QR', 'getUserMedia']
---

#text
## علامت اشتباه

نسخهٔ قبلی اسکنر فقط وجود `BarcodeDetector` را بررسی می‌کرد — API‌ای که در
Safari/iOS **پیاده‌سازی نشده**. نتیجه: روی آیفون همیشه پیام «مرورگر نمی‌تواند
اسکن کند» نمایش داده می‌شد، حتی وقتی دوربین کاملاً سالم بود.

## راه‌حل

قابلیت را روی **getUserMedia** بررسی می‌کنیم، نه BarcodeDetector:

- ویدیو با `muted playsinline` و از دل یک رویداد کاربر
- اگر مرورگر BarcodeDetector داشت، از همان استفاده می‌کنیم (اندروید/کروم)
- وگرنه رمزگشای **jsQR** به‌صورت تنبل بارگذاری می‌شود و فریم‌ها را روی canvas می‌خواند
- خطاها دقیق‌اند: دسترسی رد شده / دوربین نیست / اتصال امن نیست — «چسباندن کد» فقط وقتی واقعاً دوربینی نیست

#media
shot-qr.svg | اسکنر با دوربین فعال
shot-update.svg | فهرست دوستان با دکمهٔ اسکن

#quote
تشخیص قابلیت باید روی API‌ای باشد که واقعاً استفاده می‌کنید، نه API‌ای که برای رمزگشایی به کار می‌رود. | تیم Telepatty

#source
مستندات BarcodeDetector در MDN | https://developer.mozilla.org/docs/Web/API/BarcodeDetector

