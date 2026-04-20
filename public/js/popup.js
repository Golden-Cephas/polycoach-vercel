/* ══════════════════════════════════════
   POLYCOACH — shared popup + auth helpers
   Uses JWT stored in localStorage
   No server sessions required
══════════════════════════════════════ */

/* ── JWT TOKEN HELPERS ── */
function getToken(){ return localStorage.getItem("polycoachToken")||null; }
function getUser(){ return JSON.parse(localStorage.getItem("polycoachUser")||"null"); }

function authHeaders(){
  const t=getToken();
  return t?{"Content-Type":"application/json","Authorization":"Bearer "+t}:{"Content-Type":"application/json"};
}

function isAdmin(){
  const u=getUser();
  return u&&u.role==="admin";
}

/* ── GENERAL POPUP (About / FAQ / Contact) ── */
const POPUP_CONTENT={
  about:`<h2>About PolyCoach</h2><p>PolyCoach is the official student-run transport system for MUBAS. We provide safe, organised, and affordable travel home every semester — by students, for students.</p>`,
  faq:`<h2>Frequently Asked Questions</h2>
  <p><strong>How do I book?</strong><br>Fill in the Book form with your details and follow the steps.</p>
  <p><strong>What is the booking fee?</strong><br>K5,000 to secure a seat (this is a booking fee, not the full bus fare).</p>
  <p><strong>When is departure?</strong><br>18:00 hrs from MUBAS Main Gate.</p>
  <p><strong>How do I pay?</strong><br>Pay via mobile money, then upload your screenshot as proof of payment.</p>
  <p><strong>How long does approval take?</strong><br>Administrators verify payments as soon as possible.</p>`,
  contact:`<h2>Contact Us</h2><p><strong>Email:</strong> polycoachsupport@gmail.com</p><p><strong>Phone:</strong> +265 881 730 203</p><p>We are available to help with registration, booking, or payment verification.</p>`
};

function openPopup(type){
  const o=document.getElementById("popupOverlay"),c=document.getElementById("popupContent");
  if(!o||!c) return;
  c.innerHTML=POPUP_CONTENT[type]||"";
  o.style.display="flex";
}
function closePopup(){
  const o=document.getElementById("popupOverlay");
  if(o) o.style.display="none";
}
document.addEventListener("keydown",e=>{if(e.key==="Escape") closePopup();});

/* ── BOOKING POPUP ── */
function openBookingPopup(){
  const p=document.getElementById("bookingPopup");
  if(p){
    const ni=document.getElementById("otherPassengerName");
    if(ni){ni.style.display="none";ni.value="";}
    p.style.display="flex";
  }
}
function closeBookingPopup(){
  const p=document.getElementById("bookingPopup");
  if(p) p.style.display="none";
}
function showOtherInput(){
  const ni=document.getElementById("otherPassengerName");
  if(ni){ni.style.display="block";ni.focus();}
}
function bookForMyself(){
  const u=getUser();
  if(!u||!u.fullName){
    alert("Please fill in the booking form first.");
    window.location.href="Book-Login.html";return;
  }
  localStorage.setItem("passengerName",u.fullName);
  closeBookingPopup();
  window.location.href="Payment-Upload.html";
}
function bookForSomeone(){
  const ni=document.getElementById("otherPassengerName");
  if(!ni) return;
  const name=ni.value.trim();
  if(!name){alert("Please enter the passenger's full name.");return;}
  localStorage.setItem("passengerName",name);
  closeBookingPopup();
  window.location.href="Payment-Upload.html";
}
