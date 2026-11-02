// SPDX-License-Identifier: AGPL-3.0-only
import pg from 'pg';
import { config } from '../config/index.js';
import { decryptToken } from '../crypto/encryption.js';

export interface WabaConnection {
  connectionId: string;
  ownerType: 'platform' | 'tenant';
  metaAppKey: 'relay' | 'tech_provider';
  tenantId?: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  accessTokenEnc?: string;
  tokenKeyVersion: number;
  templateName: string;
  templateStatus: string;
  qualityRating: string;
  status: 'active' | 'throttled' | 'suspended' | 'disconnected';
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedWabaCredentials {
  connectionId: string;
  phoneNumberId: string;
  accessToken: string;
  metaAppKey: 'relay' | 'tech_provider';
  templateName: string;
  isPlatform: boolean;
}

export class WabaConnectionManager {
  private pool?: pg.Pool;

  constructor(pool?: pg.Pool) {
    this.pool = pool;
  }

  setPool(pool: pg.Pool): void {
    this.pool = pool;
  }

  /**
   * Retrieves a WABA connection by phone_number_id (used by incoming webhook handler)
   */
  async getByPhoneNumberId(phoneNumberId: string): Promise<WabaConnection | undefined> {
    if (!this.pool) {
      // Memory/fallback: check if matches platform configuration
      if (phoneNumberId === config.meta.phoneNumberId) {
        return this.getPlatformDefaultConnection();
      }
      return undefined;
    }

    const res = await this.pool.query(
      'SELECT * FROM waba_connections WHERE phone_number_id = $1',
      [phoneNumberId]
    );

    if (res.rows.length === 0) {
      // If it matches platform config but not in DB yet, fallback to platform default
      if (phoneNumberId === config.meta.phoneNumberId) {
        return this.getPlatformDefaultConnection();
      }
      return undefined;
    }

    return this.mapRow(res.rows[0]);
  }

  /**
   * Retrieves a WABA connection by connection_id
   */
  async getById(connectionId: string): Promise<WabaConnection | undefined> {
    if (!this.pool) {
      if (connectionId === 'conn_platform_default') {
        return this.getPlatformDefaultConnection();
      }
      return undefined;
    }

    const res = await this.pool.query(
      'SELECT * FROM waba_connections WHERE connection_id = $1',
      [connectionId]
    );

    if (res.rows.length === 0) return undefined;
    return this.mapRow(res.rows[0]);
  }

  /**
   * Resolves active access token and credentials for a connection
   * If platform: uses META_ACCESS_TOKEN from env
   * If tenant BYO: decrypts access_token_enc using AES-256-GCM
   */
  resolveCredentials(conn: WabaConnection): ResolvedWabaCredentials {
    if (conn.ownerType === 'platform') {
      return {
        connectionId: conn.connectionId,
        phoneNumberId: conn.phoneNumberId,
        accessToken: config.meta.accessToken,
        metaAppKey: 'relay',
        templateName: conn.templateName || config.meta.utilityTemplateName,
        isPlatform: true,
      };
    }

    // Tenant BYO-WABA
    let decryptedToken = '';
    if (conn.accessTokenEnc) {
      try {
        decryptedToken = decryptToken(conn.accessTokenEnc);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[WabaConnection] Failed to decrypt access token for connection ${conn.connectionId}: ${msg}`);
      }
    }

    return {
      connectionId: conn.connectionId,
      phoneNumberId: conn.phoneNumberId,
      accessToken: decryptedToken,
      metaAppKey: conn.metaAppKey,
      templateName: conn.templateName || config.meta.utilityTemplateName,
      isPlatform: false,
    };
  }

  private getPlatformDefaultConnection(): WabaConnection {
    return {
      connectionId: 'conn_platform_default',
      ownerType: 'platform',
      metaAppKey: 'relay',
      wabaId: config.meta.wabaId || 'waba_platform',
      phoneNumberId: config.meta.phoneNumberId,
      displayPhoneNumber: config.meta.displayPhoneNumber || config.meta.csPhone,
      tokenKeyVersion: 1,
      templateName: config.meta.utilityTemplateName,
      templateStatus: 'APPROVED',
      qualityRating: 'GREEN',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private mapRow(r: Record<string, unknown>): WabaConnection {
    return {
      connectionId: String(r.connection_id),
      ownerType: r.owner_type as 'platform' | 'tenant',
      metaAppKey: r.meta_app_key as 'relay' | 'tech_provider',
      tenantId: r.tenant_id ? String(r.tenant_id) : undefined,
      wabaId: String(r.waba_id),
      phoneNumberId: String(r.phone_number_id),
      displayPhoneNumber: String(r.display_phone_number),
      accessTokenEnc: r.access_token_enc ? String(r.access_token_enc) : undefined,
      tokenKeyVersion: Number(r.token_key_version || 1),
      templateName: String(r.template_name || 'livechat_ticket_alert'),
      templateStatus: String(r.template_status || 'PENDING'),
      qualityRating: String(r.quality_rating || 'GREEN'),
      status: r.status as 'active' | 'throttled' | 'suspended' | 'disconnected',
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
}

export const wabaManager = new WabaConnectionManager();

