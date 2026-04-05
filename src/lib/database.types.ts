export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          scores: Json | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          scores?: Json | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          scores?: Json | null
        }
        Relationships: []
      }
      chunks: {
        Row: {
          chunk_index: number
          clause_number: string | null
          content: string
          created_at: string | null
          document_id: string
          embedding: string | null
          id: string
          metadata: Json | null
          page_number: number
          section_title: string | null
        }
        Insert: {
          chunk_index: number
          clause_number?: string | null
          content: string
          created_at?: string | null
          document_id: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          page_number: number
          section_title?: string | null
        }
        Update: {
          chunk_index?: number
          clause_number?: string | null
          content?: string
          created_at?: string | null
          document_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          page_number?: number
          section_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          classification: Json | null
          created_at: string | null
          id: string
          mode: string
          model: string | null
          query: string
          response: string | null
          scores: Json | null
          search_results: Json | null
          sources: Json | null
          title: string
          updated_at: string | null
        }
        Insert: {
          classification?: Json | null
          created_at?: string | null
          id?: string
          mode?: string
          model?: string | null
          query: string
          response?: string | null
          scores?: Json | null
          search_results?: Json | null
          sources?: Json | null
          title: string
          updated_at?: string | null
        }
        Update: {
          classification?: Json | null
          created_at?: string | null
          id?: string
          mode?: string
          model?: string | null
          query?: string
          response?: string | null
          scores?: Json | null
          search_results?: Json | null
          sources?: Json | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      doctrines: {
        Row: {
          content_ar: string
          content_en: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          title: string
          updated_at: string | null
          version: number | null
        }
        Insert: {
          content_ar: string
          content_en: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          title: string
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          content_ar?: string
          content_en?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          title?: string
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      document_entities: {
        Row: {
          document_id: string
          entity_id: string
          role: string | null
        }
        Insert: {
          document_id: string
          entity_id: string
          role?: string | null
        }
        Update: {
          document_id?: string
          entity_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_entities_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_entities_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      document_references: {
        Row: {
          created_at: string | null
          id: string
          reference_text: string
          reference_type: string
          resolved: boolean | null
          source_id: string
          target_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          reference_text: string
          reference_type?: string
          resolved?: boolean | null
          source_id: string
          target_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          reference_text?: string
          reference_type?: string
          resolved?: boolean | null
          source_id?: string
          target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_references_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_references_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          classification: string
          created_at: string | null
          encrypted_content: string | null
          entities: string[] | null
          file_size: number | null
          file_url: string
          id: string
          is_current: boolean | null
          language: string
          metadata: Json | null
          page_count: number | null
          processing_error: string | null
          status: string
          supersedes: string | null
          title: string
          type: string
          updated_at: string | null
          version_number: number | null
          version_of: string | null
        }
        Insert: {
          classification?: string
          created_at?: string | null
          encrypted_content?: string | null
          entities?: string[] | null
          file_size?: number | null
          file_url: string
          id?: string
          is_current?: boolean | null
          language?: string
          metadata?: Json | null
          page_count?: number | null
          processing_error?: string | null
          status?: string
          supersedes?: string | null
          title: string
          type?: string
          updated_at?: string | null
          version_number?: number | null
          version_of?: string | null
        }
        Update: {
          classification?: string
          created_at?: string | null
          encrypted_content?: string | null
          entities?: string[] | null
          file_size?: number | null
          file_url?: string
          id?: string
          is_current?: boolean | null
          language?: string
          metadata?: Json | null
          page_count?: number | null
          processing_error?: string | null
          status?: string
          supersedes?: string | null
          title?: string
          type?: string
          updated_at?: string | null
          version_number?: number | null
          version_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_version_of_fkey"
            columns: ["version_of"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          created_at: string | null
          id: string
          metadata: Json | null
          name: string
          name_en: string | null
          type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          metadata?: Json | null
          name: string
          name_en?: string | null
          type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          name_en?: string | null
          type?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          comment: string | null
          conversation_id: string
          corrections: Json | null
          created_at: string | null
          id: string
          rating: number | null
        }
        Insert: {
          comment?: string | null
          conversation_id: string
          corrections?: Json | null
          created_at?: string | null
          id?: string
          rating?: number | null
        }
        Update: {
          comment?: string | null
          conversation_id?: string
          corrections?: Json | null
          created_at?: string | null
          id?: string
          rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge: {
        Row: {
          active: boolean | null
          content: string
          context: string | null
          created_at: string | null
          id: string
          relevance_score: number | null
          source_conversation_id: string | null
          source_document_id: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          content: string
          context?: string | null
          created_at?: string | null
          id?: string
          relevance_score?: number | null
          source_conversation_id?: string | null
          source_document_id?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          content?: string
          context?: string | null
          created_at?: string | null
          id?: string
          relevance_score?: number | null
          source_conversation_id?: string | null
          source_document_id?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          id: string
          metadata: Json | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hybrid_search: {
        Args: {
          filter_classification?: string
          filter_document_id?: string
          match_count?: number
          query_embedding: string
          query_text: string
        }
        Returns: {
          chunk_id: string
          clause_number: string
          combined_score: number
          content: string
          document_id: string
          fts_rank: number
          page_number: number
          section_title: string
          similarity: number
        }[]
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
