
// API Base URL
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:5000/api' : '/api';

// Global state
let currentUser = null;
let authToken = localStorage.getItem('authToken');

// Authentication functions
async function login(email, password) {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (data.success) {
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      return { success: true, user: data.user };
    } else {
      return { success: false, message: data.message };
    }
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, message: 'Network error. Please try again.' };
  }
}

async function register(userData) {
  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userData)
    });

    const data = await response.json();

    if (data.success) {
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      return { success: true, user: data.user };
    } else {
      return { success: false, message: data.message };
    }
  } catch (error) {
    console.error('Registration error:', error);
    return { success: false, message: 'Network error. Please try again.' };
  }
}

async function logout() {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
  } catch (error) {
    console.error('Logout error:', error);
  }

  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  window.location.href = 'index.html';
}

async function checkAuth() {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('currentUser');

  if (token && user) {
    authToken = token;
    currentUser = JSON.parse(user);

    // Verify token is still valid
    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        currentUser = data.user;
        return true;
      }
    } catch (error) {
      console.error('Auth check error:', error);
    }
  }

  logout();
  return false;
}

// API helper function
async function apiRequest(endpoint, options = {}) {
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken && { 'Authorization': `Bearer ${authToken}` })
    }
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'API request failed');
    }

    return data;
  } catch (error) {
    console.error('API request error:', error);
    throw error;
  }
}

// Search functionality
document.addEventListener('DOMContentLoaded', function() {
  const searchForm = document.getElementById('bloodSearchForm');
  if (searchForm) {
    searchForm.addEventListener('submit', handleBloodSearch);
  }
});

async function handleBloodSearch(e) {
  e.preventDefault();

  const bloodType = document.getElementById('searchBloodType').value;
  const location = document.getElementById('searchLocation').value;
  const urgency = document.getElementById('searchUrgency').value;

  const searchBtn = e.target.querySelector('button[type="submit"]');
  const originalText = searchBtn.innerHTML;
  searchBtn.innerHTML = '<span class="loading"></span> Searching...';
  searchBtn.disabled = true;

  try {
    const params = new URLSearchParams();
    if (bloodType) params.append('bloodType', bloodType);
    if (location) params.append('location', location);
    if (urgency) params.append('urgency', urgency);

    const response = await fetch(`${API_BASE}/requests/search?${params}`, {
      headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
    });

    const data = await response.json();

    if (data.success) {
      displaySearchResults(data.requests);
    } else {
      showAlert(data.message || 'Search failed', 'error');
    }
  } catch (error) {
    console.error('Search error:', error);
    showAlert('Search failed. Please try again.', 'error');
  } finally {
    searchBtn.innerHTML = originalText;
    searchBtn.disabled = false;
  }
}

function displaySearchResults(requests) {
  const resultsContainer = document.getElementById('searchResults');
  const resultsList = document.getElementById('resultsList');

  if (requests.length === 0) {
    resultsList.innerHTML = '<p class="text-center text-gray-600 py-4">No matching requests found. Try adjusting your search criteria.</p>';
  } else {
    resultsList.innerHTML = requests.map(request => `
      <div class="card p-4">
        <div class="flex justify-between items-start mb-2">
          <h4 class="font-semibold text-lg">${request.patientName || 'Patient'}</h4>
          <span class="px-2 py-1 rounded text-sm font-medium ${
            request.urgency === 'emergency' ? 'bg-red-100 text-red-800' :
            request.urgency === 'urgent' ? 'bg-yellow-100 text-yellow-800' :
            'bg-green-100 text-green-800'
          }">${request.urgency}</span>
        </div>
        <p class="text-gray-600 mb-2"><strong>Blood Type:</strong> ${request.bloodType}</p>
        <p class="text-gray-600 mb-2"><strong>Location:</strong> ${request.location}</p>
        <p class="text-gray-600 mb-2"><strong>Hospital:</strong> ${request.hospital?.name || 'Hospital'}</p>
        <p class="text-gray-600 mb-4"><strong>Units Needed:</strong> ${request.unitsNeeded}</p>
        <button class="btn-primary w-full" onclick="contactHospital('${request._id}')">
          Contact Hospital
        </button>
      </div>
    `).join('');
  }

  resultsContainer.classList.remove('hidden');
}

function contactHospital(requestId) {
  if (!currentUser) {
    window.location.href = 'pages/login.html';
    return;
  }

  // In a real app, this would open a contact form or modal
  showAlert('Contact form would open here. Request ID: ' + requestId, 'success');
}

// UI functions
function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  const btn = document.getElementById('darkModeBtn');
  if (btn) {
    btn.innerHTML = document.body.classList.contains("dark-mode") ? '☀️' : '🌙';
  }
  localStorage.setItem('darkMode', document.body.classList.contains("dark-mode"));
}

function toggleMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  menu.classList.toggle('hidden');
}

// Show alert/notification
function showAlert(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <div class="flex items-center">
      <span>${message}</span>
      <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-lg">&times;</button>
    </div>
  `;

  document.body.appendChild(notification);
  notification.classList.add('show');

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

// Load dark mode preference
document.addEventListener('DOMContentLoaded', function() {
  const darkMode = localStorage.getItem('darkMode') === 'true';
  if (darkMode) {
    document.body.classList.add('dark-mode');
    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.innerHTML = '☀️';
  }

  // Check authentication for protected pages
  const protectedPages = ['donor-dashboard.html', 'hospital-dashboard.html', 'admin-dashboard.html'];
  const currentPage = window.location.pathname.split('/').pop();

  if (protectedPages.includes(currentPage)) {
    checkAuth().then(isAuthenticated => {
      if (!isAuthenticated) {
        window.location.href = 'login.html';
      } else {
        // Load page-specific data
        loadPageData(currentPage);
      }
    });
  }

  // Smooth scrolling for anchor links
  const anchorLinks = document.querySelectorAll('a[href^="#"]');
  anchorLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const targetId = this.getAttribute('href').substring(1);
      const targetElement = document.getElementById(targetId);
      if (targetElement) {
        const offsetTop = targetElement.offsetTop - 80; // Account for fixed nav
        window.scrollTo({
          top: offsetTop,
          behavior: 'smooth'
        });
      }
    });
  });

  // Close mobile menu when clicking outside
  document.addEventListener('click', function(e) {
    const mobileMenu = document.getElementById('mobileMenu');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenu && mobileMenuBtn && !mobileMenuBtn.contains(e.target) && !mobileMenu.contains(e.target)) {
      mobileMenu.classList.add('hidden');
    }
  });
});

// Load page-specific data
async function loadPageData(page) {
  try {
    switch (page) {
      case 'donor-dashboard.html':
        await loadDonorDashboard();
        break;
      case 'hospital-dashboard.html':
        await loadHospitalDashboard();
        break;
      case 'admin-dashboard.html':
        await loadAdminDashboard();
        break;
    }
  } catch (error) {
    console.error('Error loading page data:', error);
    showAlert('Error loading page data', 'error');
  }
}

// Dashboard loading functions
async function loadDonorDashboard() {
  const data = await apiRequest('/donors/dashboard');

  // Update stats
  document.getElementById('totalDonations').textContent = data.dashboard.stats.totalDonations;
  document.getElementById('totalUnits').textContent = data.dashboard.stats.totalUnits;
  document.getElementById('lastDonation').textContent = data.dashboard.stats.lastDonation ?
    new Date(data.dashboard.stats.lastDonation).toLocaleDateString() : 'Never';

  // Update eligibility
  const eligibilityDiv = document.getElementById('eligibilityStatus');
  if (eligibilityDiv) {
    eligibilityDiv.innerHTML = data.dashboard.isEligible ?
      '<span class="text-green-600 font-semibold">Eligible to Donate</span>' :
      `<span class="text-red-600 font-semibold">Next eligible: ${new Date(data.dashboard.nextEligibleDate).toLocaleDateString()}</span>`;
  }

  // Load recent donations
  const donationsContainer = document.getElementById('recentDonations');
  if (donationsContainer) {
    donationsContainer.innerHTML = data.dashboard.recentDonations.map(donation => `
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded">
        <div>
          <div class="font-semibold">${donation.hospital?.name || 'Hospital'}</div>
          <div class="text-sm text-gray-600">${new Date(donation.donationDate).toLocaleDateString()}</div>
        </div>
        <span class="bg-green-100 text-green-800 px-2 py-1 rounded text-sm">${donation.status}</span>
      </div>
    `).join('');
  }
}

async function loadHospitalDashboard() {
  const data = await apiRequest('/hospitals/dashboard');

  // Update stats
  document.getElementById('totalRequests').textContent = data.dashboard.stats.totalRequests;
  document.getElementById('pendingRequests').textContent = data.dashboard.stats.pendingRequests;
  document.getElementById('fulfilledRequests').textContent = data.dashboard.stats.fulfilledRequests;

  // Update blood inventory
  const inventoryContainer = document.getElementById('bloodInventory');
  if (inventoryContainer) {
    inventoryContainer.innerHTML = data.dashboard.bloodInventory.map(item => `
      <div class="flex justify-between items-center p-3 border rounded">
        <span class="font-semibold">${item.type}</span>
        <div class="text-right">
          <div class="font-bold">${item.units} units</div>
          <span class="text-sm ${item.status === 'adequate' ? 'text-green-600' :
                                item.status === 'low' ? 'text-yellow-600' : 'text-red-600'}">
            ${item.status}
          </span>
        </div>
      </div>
    `).join('');
  }
}

async function loadAdminDashboard() {
  const data = await apiRequest('/analytics/dashboard');

  // Update user stats
  const userStats = data.analytics.userStats;
  document.getElementById('totalUsers').textContent = userStats.reduce((sum, stat) => sum + stat.count, 0);
  document.getElementById('totalDonors').textContent = userStats.find(s => s._id === 'donor')?.count || 0;
  document.getElementById('totalHospitals').textContent = userStats.find(s => s._id === 'hospital')?.count || 0;

  // Update request stats
  const requestStats = data.analytics.requestStats;
  document.getElementById('totalRequests').textContent = requestStats.reduce((sum, stat) => sum + stat.count, 0);
  document.getElementById('pendingRequests').textContent = requestStats.find(s => s._id === 'pending')?.count || 0;
  document.getElementById('fulfilledRequests').textContent = requestStats.find(s => s._id === 'fulfilled')?.count || 0;
}

function showAlert(msg, type = 'success') {
  // Create alert element
  const alert = document.createElement('div');
  alert.className = `fixed top-20 right-4 z-50 p-4 rounded-lg shadow-lg transition-all duration-300 transform translate-x-full ${
    type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500'
  } text-white`;
  alert.innerHTML = `
    <div class="flex items-center">
      <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'} mr-2"></i>
      <span>${msg}</span>
    </div>
  `;

  document.body.appendChild(alert);

  // Animate in
  setTimeout(() => {
    alert.classList.remove('translate-x-full');
  }, 100);

  // Remove after 3 seconds
  setTimeout(() => {
    alert.classList.add('translate-x-full');
    setTimeout(() => {
      document.body.removeChild(alert);
    }, 300);
  }, 3000);
}

function performBloodSearch() {
  const bloodType = document.getElementById('searchBloodType').value;
  const location = document.getElementById('searchLocation').value;
  const urgency = document.getElementById('searchUrgency').value;

  if (!currentUser) {
    showAlert('Please login to search for blood donors', 'info');
    setTimeout(() => {
      window.location.href = 'pages/login.html';
    }, 2000);
    return;
  }

  // Show loading
  const searchBtn = document.querySelector('#bloodSearchForm button[type="submit"]');
  const originalText = searchBtn.innerHTML;
  searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Searching...';
  searchBtn.disabled = true;

  // Call API to search for donors
  apiRequest(`/users/donors/search?bloodType=${bloodType}&location=${location}&urgency=${urgency}`)
    .then(data => {
      if (data.success && data.donors.length > 0) {
        displaySearchResults(data.donors);
        document.getElementById('searchResults').classList.remove('hidden');
      } else {
        showAlert('No donors found matching your criteria', 'info');
        document.getElementById('searchResults').classList.add('hidden');
      }
    })
    .catch(error => {
      console.error('Search error:', error);
      showAlert('Search failed. Please try again.', 'error');
    })
    .finally(() => {
      // Reset button
      searchBtn.innerHTML = originalText;
      searchBtn.disabled = false;
    });
}

function displaySearchResults(donors) {
  const resultsContainer = document.getElementById('resultsList');
  if (!resultsContainer) return;

  resultsContainer.innerHTML = donors.map(donor => `
    <div class="bg-white p-4 rounded-lg shadow-md border">
      <div class="flex justify-between items-start">
        <div>
          <h3 class="font-bold text-lg">${donor.firstName} ${donor.lastName}</h3>
          <p class="text-gray-600">${donor.location || 'Location not specified'}</p>
          <p class="text-sm text-gray-500">Last donation: ${donor.lastDonation ? new Date(donor.lastDonation).toLocaleDateString() : 'Never'}</p>
        </div>
        <span class="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-semibold">
          ${donor.bloodType}
        </span>
      </div>
      <div class="mt-3 flex gap-2">
        <button onclick="contactDonor('${donor.phone}')" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition">
          <i class="fas fa-phone mr-1"></i>Contact
        </button>
        <button onclick="viewDonorProfile('${donor._id}')" class="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition">
          <i class="fas fa-user mr-1"></i>Profile
        </button>
      </div>
    </div>
  `).join('');
}

function contactDonor(phone) {
  if (currentUser) {
    window.location.href = `tel:${phone}`;
  } else {
    showAlert('Please login to contact donors', 'info');
  }
}

function viewDonorProfile(donorId) {
  showAlert(`Viewing donor profile for ID: ${donorId}`, 'info');
  // In a real implementation, this would open a modal or navigate to a profile page
}

function displaySearchResults(results) {
  const resultsContainer = document.getElementById('searchResults');
  const resultsList = document.getElementById('resultsList');

  if (results.length === 0) {
    resultsList.innerHTML = '<p class="text-gray-600 text-center py-8">No donors found matching your criteria. Try adjusting your search.</p>';
  } else {
    resultsList.innerHTML = results.map(result => `
      <div class="bg-white p-4 rounded-lg shadow border">
        <div class="flex justify-between items-start mb-2">
          <div>
            <h4 class="font-semibold text-lg">${result.name}</h4>
            <p class="text-gray-600">${result.bloodType} • ${result.distance}</p>
            <p class="text-gray-600">${result.location}</p>
          </div>
          <span class="bg-green-100 text-green-800 px-2 py-1 rounded text-sm">${result.status}</span>
        </div>
        <div class="flex space-x-2 mt-3">
          <button onclick="contactDonor('${result.phone}')" class="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 transition">
            <i class="fas fa-phone mr-1"></i>Contact
          </button>
          <button onclick="viewProfile('${result.name}')" class="bg-gray-600 text-white px-4 py-2 rounded text-sm hover:bg-gray-700 transition">
            <i class="fas fa-user mr-1"></i>Profile
          </button>
        </div>
      </div>
    `).join('');
  }

  resultsContainer.classList.remove('hidden');
  resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function contactDonor(phone) {
  if (confirm(`Call ${phone}?`)) {
    window.location.href = `tel:${phone}`;
  }
}

function viewProfile(name) {
  showAlert(`Viewing profile for ${name}`);
}
