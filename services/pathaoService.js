/**
 * ============================================================
 * services/pathaoService.js — Pathao Courier Aladdin API Service
 * ============================================================
 * Handles OAuth2 authentication, token caching, cascading location lookups,
 * parcel dispatch / order creation, and live parcel tracking.
 * ============================================================
 */
const axios = require("axios");

class PathaoService {
  constructor() {
    this.token = null;
    this.tokenExpiresAt = null;
    this.refreshToken = null;
  }

  getBaseUrl() {
    return (
      process.env.PATHAO_BASE_URL ||
      "https://courier-api-sandbox.pathao.com"
    ).replace(/\/+$/, "");
  }

  /**
   * Issue or reuse cached Pathao Access Token
   */
  async getAccessToken() {
    // If token exists and is valid for at least another 5 minutes, reuse it
    if (
      this.token &&
      this.tokenExpiresAt &&
      Date.now() < this.tokenExpiresAt - 5 * 60 * 1000
    ) {
      return this.token;
    }

    const baseUrl = this.getBaseUrl();
    const payload = {
      client_id: process.env.PATHAO_CLIENT_ID || "7N1aMJQbWm",
      client_secret:
        process.env.PATHAO_CLIENT_SECRET ||
        "wRcaibZkUdSNz2EI9ZyuXLlNrnAv0TdPUPXMnD39",
      username: process.env.PATHAO_USERNAME || "test@pathao.com",
      password: process.env.PATHAO_PASSWORD || "lovePathao",
      grant_type: process.env.PATHAO_GRANT_TYPE || "password",
    };

    try {
      const response = await axios.post(
        `${baseUrl}/aladdin/api/v1/issue-token`,
        payload,
        {
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          timeout: 15000,
        }
      );

      const data = response.data;
      if (data && data.access_token) {
        this.token = data.access_token;
        this.refreshToken = data.refresh_token || null;
        // expires_in is in seconds
        const expiresInMs = (data.expires_in || 604800) * 1000;
        this.tokenExpiresAt = Date.now() + expiresInMs;
        return this.token;
      }

      throw new Error("Invalid token response from Pathao API");
    } catch (error) {
      console.error(
        "Pathao Token Issue Error:",
        error.response?.data || error.message
      );
      const errMsg =
        error.response?.data?.message ||
        error.response?.data?.error_description ||
        "Failed to authenticate with Pathao Courier API. Check credentials.";
      throw new Error(errMsg);
    }
  }

  /**
   * Helper to make authenticated requests to Pathao API
   */
  async request(method, endpoint, data = null, params = null) {
    const token = await this.getAccessToken();
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

    try {
      const config = {
        method,
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        timeout: 20000,
      };

      if (data) config.data = data;
      if (params) config.params = params;

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error(
        `Pathao API Error [${method} ${endpoint}]:`,
        error.response?.data || error.message
      );

      // If token expired / unauthorized (401), invalidate and retry once
      if (error.response?.status === 401 && this.token) {
        this.token = null;
        this.tokenExpiresAt = null;
        const freshToken = await this.getAccessToken();
        const retryConfig = {
          method,
          url,
          headers: {
            Authorization: `Bearer ${freshToken}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          timeout: 20000,
        };
        if (data) retryConfig.data = data;
        if (params) retryConfig.params = params;
        const retryResponse = await axios(retryConfig);
        return retryResponse.data;
      }

      const errData = error.response?.data;
      const errorMsg =
        errData?.message ||
        (errData?.errors && typeof errData.errors === "object"
          ? Object.values(errData.errors).flat().join(", ")
          : null) ||
        error.message ||
        "Pathao API request failed";

      const err = new Error(errorMsg);
      err.response = error.response;
      throw err;
    }
  }

  /**
   * Get list of merchant stores (pickup locations)
   */
  async getStores() {
    return this.request("GET", "/aladdin/api/v1/stores");
  }

  /**
   * Create a new pickup store
   */
  async createStore(storeData) {
    return this.request("POST", "/aladdin/api/v1/stores", storeData);
  }

  /**
   * Get list of all cities in Bangladesh
   */
  async getCities() {
    return this.request("GET", "/aladdin/api/v1/city-list");
  }

  /**
   * Get list of zones for a given city
   */
  async getZones(cityId) {
    if (!cityId) throw new Error("cityId is required to fetch zones");
    return this.request("GET", `/aladdin/api/v1/cities/${cityId}/zone-list`);
  }

  /**
   * Get list of areas for a given zone
   */
  async getAreas(zoneId) {
    if (!zoneId) throw new Error("zoneId is required to fetch areas");
    return this.request("GET", `/aladdin/api/v1/zones/${zoneId}/area-list`);
  }

  /**
   * Calculate delivery cost preview
   */
  async calculatePrice(pricePlanData) {
    return this.request(
      "POST",
      "/aladdin/api/v1/merchant/price-plan",
      pricePlanData
    );
  }

  /**
   * Create / Dispatch Order to Pathao
   */
  async createOrder(orderData) {
    return this.request("POST", "/aladdin/api/v1/orders", orderData);
  }

  /**
   * Track parcel delivery status by consignmentId
   */
  async trackOrder(consignmentId) {
    if (!consignmentId) throw new Error("consignmentId is required");
    return this.request("GET", `/aladdin/api/v1/orders/${consignmentId}/info`);
  }
}

// Singleton instance
module.exports = new PathaoService();
