# Rational-Expression-Review

A couple of things you should know if you're using this. This is a tool made for me as a math teacher using basically claude to manage assignments my students do. If you are expecting something more sophisticated I am sorry you have come to the wrong place. This is very much brute force.

If you wish to make your own copy you must use the gs file and:

Step 1 — Set up the Google Sheet

Create a new Google Sheet and name it something like "Math Worksheet Submissions"
Click Extensions → Apps Script
Delete everything in the editor and paste the entire SubmissionReceiver.gs file contents
Click Save

Step 2 — Deploy as a Web App

Click Deploy → New Deployment
Click the gear icon next to "Type" and select Web app
Set Execute as: Me
Set Who has access: Anyone
Click Deploy and copy the Web App URL it gives you

Step 3 — Paste the URL into both HTML files
In both unit8_exam_review.html and chapter8_review.html, find this line near the bottom of the script:
const APPS_SCRIPT_URL = 'PASTE_YOUR_WEB_APP_URL_HERE';
Replace PASTE_YOUR_WEB_APP_URL_HERE with your actual URL, then re-upload both files to GitHub.

You will need to set up your own pin if you wish to add or remove files please message me if you want that and I can send you a clean copy as I don't just want to share the pin I use myself.
