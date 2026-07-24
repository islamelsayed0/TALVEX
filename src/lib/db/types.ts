// GENERATED FILE. Do not edit by hand.
// Regenerate after every migration, with the local stack running:
//   npx supabase db reset && npx supabase gen types typescript --local --schema public
// (or the Supabase MCP tool generate_typescript_types against project
// rdfuzadtraxzrrthhnnp). Then re-append the convenience aliases at the bottom.
// Source of truth is the schema in supabase/migrations/.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      incident_events: {
        Row: {
          check_id: string | null
          detail: string | null
          event_type: string
          id: string
          incident_id: string
          occurred_at: string
          org_id: string
        }
        Insert: {
          check_id?: string | null
          detail?: string | null
          event_type: string
          id?: string
          incident_id: string
          occurred_at: string
          org_id: string
        }
        Update: {
          check_id?: string | null
          detail?: string | null
          event_type?: string
          id?: string
          incident_id?: string
          occurred_at?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_events_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "monitor_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_events_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          created_at: string
          id: string
          last_reopened_at: string | null
          monitor_id: string
          opened_at: string
          org_id: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_reopened_at?: string | null
          monitor_id: string
          opened_at: string
          org_id: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_reopened_at?: string | null
          monitor_id?: string
          opened_at?: string
          org_id?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "monitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      monitor_checks: {
        Row: {
          checked_at: string
          error_message: string | null
          id: string
          monitor_id: string
          org_id: string
          response_time_ms: number | null
          status: string
        }
        Insert: {
          checked_at?: string
          error_message?: string | null
          id?: string
          monitor_id: string
          org_id: string
          response_time_ms?: number | null
          status: string
        }
        Update: {
          checked_at?: string
          error_message?: string | null
          id?: string
          monitor_id?: string
          org_id?: string
          response_time_ms?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitor_checks_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "monitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitor_checks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      monitor_daily_rollups: {
        Row: {
          avg_response_ms: number | null
          check_count: number
          day: string
          max_response_ms: number | null
          min_response_ms: number | null
          monitor_id: string
          org_id: string
          uptime_percent: number
        }
        Insert: {
          avg_response_ms?: number | null
          check_count: number
          day: string
          max_response_ms?: number | null
          min_response_ms?: number | null
          monitor_id: string
          org_id: string
          uptime_percent: number
        }
        Update: {
          avg_response_ms?: number | null
          check_count?: number
          day?: string
          max_response_ms?: number | null
          min_response_ms?: number | null
          monitor_id?: string
          org_id?: string
          uptime_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "monitor_daily_rollups_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "monitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitor_daily_rollups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      monitors: {
        Row: {
          active: boolean
          created_at: string
          failing_since: string | null
          id: string
          interval_seconds: number
          last_checked_at: string | null
          last_status: string | null
          name: string
          org_id: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          failing_since?: string | null
          id?: string
          interval_seconds?: number
          last_checked_at?: string | null
          last_status?: string | null
          name: string
          org_id: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          failing_since?: string | null
          id?: string
          interval_seconds?: number
          last_checked_at?: string | null
          last_status?: string | null
          name?: string
          org_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          clerk_user_id: string
          created_at: string
          org_id: string
          role: string
        }
        Insert: {
          clerk_user_id: string
          created_at?: string
          org_id: string
          role: string
        }
        Update: {
          clerk_user_id?: string
          created_at?: string
          org_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          clerk_org_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          clerk_org_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          clerk_org_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      ticket_comments: {
        Row: {
          author: string
          body: string
          created_at: string
          id: string
          org_id: string
          ticket_id: string
        }
        Insert: {
          author: string
          body: string
          created_at?: string
          id?: string
          org_id: string
          ticket_id: string
        }
        Update: {
          author?: string
          body?: string
          created_at?: string
          id?: string
          org_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_comments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_events: {
        Row: {
          actor: string | null
          detail: string | null
          event_type: string
          id: string
          occurred_at: string
          org_id: string
          ticket_id: string
        }
        Insert: {
          actor?: string | null
          detail?: string | null
          event_type: string
          id?: string
          occurred_at?: string
          org_id: string
          ticket_id: string
        }
        Update: {
          actor?: string | null
          detail?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          org_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          closed_at: string | null
          created_at: string
          description: string
          id: string
          incident_id: string | null
          org_id: string
          resolved_at: string | null
          status: string
          submitted_by: string
          title: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          description: string
          id?: string
          incident_id?: string | null
          org_id: string
          resolved_at?: string | null
          status?: string
          submitted_by: string
          title: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          description?: string
          id?: string
          incident_id?: string | null
          org_id?: string
          resolved_at?: string | null
          status?: string
          submitted_by?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clerk_active_org_id: { Args: never; Returns: string }
      clerk_is_org_admin: { Args: never; Returns: boolean }
      clerk_user_id: { Args: never; Returns: string }
      is_org_admin: { Args: { p_org_id: string }; Returns: boolean }
      upsert_monitor_daily_rollups: {
        Args: { p_day: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const



// Convenience aliases used by the data layer.
export type Organization = Tables<"organizations">
export type OrgMember = Tables<"org_members">
export type OrgMemberRole = "owner" | "admin" | "technician" | "member"
export type Monitor = Tables<"monitors">
export type MonitorCheck = Tables<"monitor_checks">
export type MonitorDailyRollup = Tables<"monitor_daily_rollups">
/** Check outcome as stored. The UI adds "pending" for never checked monitors. */
export type MonitorStatus = "up" | "down"
export type Incident = Tables<"incidents">
export type IncidentEvent = Tables<"incident_events">
export type IncidentStatus = "open" | "resolved"
export type IncidentEventType = "opened" | "reopened" | "recovered" | "resolved"
export type Ticket = Tables<"tickets">
export type TicketComment = Tables<"ticket_comments">
export type TicketEvent = Tables<"ticket_events">
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed"
export type TicketEventType =
  | "created"
  | "status_changed"
  | "auto_closed"
  | "created_from_incident"
