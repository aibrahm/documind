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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      artifacts: {
        Row: {
          citations: Json | null
          content: string
          conversation_id: string | null
          created_at: string | null
          entity_id: string | null
          id: string
          kind: string
          metadata: Json | null
          project_id: string | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          citations?: Json | null
          content: string
          conversation_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          id?: string
          kind: string
          metadata?: Json | null
          project_id?: string | null
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          citations?: Json | null
          content?: string
          conversation_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          id?: string
          kind?: string
          metadata?: Json | null
          project_id?: string | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
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
      conversation_documents: {
        Row: {
          added_at: string
          conversation_id: string
          document_id: string
          role: string | null
        }
        Insert: {
          added_at?: string
          conversation_id: string
          document_id: string
          role?: string | null
        }
        Update: {
          added_at?: string
          conversation_id?: string
          document_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_documents_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_entities: {
        Row: {
          added_at: string
          conversation_id: string
          entity_id: string
          role: string | null
        }
        Insert: {
          added_at?: string
          conversation_id: string
          entity_id: string
          role?: string | null
        }
        Update: {
          added_at?: string
          conversation_id?: string
          entity_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_entities_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_entities_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_memory: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          entities: string[] | null
          id: string
          importance: number | null
          kind: string
          project_id: string | null
          text: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          entities?: string[] | null
          id?: string
          importance?: number | null
          kind: string
          project_id?: string | null
          text: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          entities?: string[] | null
          id?: string
          importance?: number | null
          kind?: string
          project_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_memory_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_memory_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          classification: Json | null
          created_at: string | null
          id: string
          kind: string
          last_message_at: string | null
          mode: string
          model: string | null
          project_id: string | null
          purpose: string | null
          query: string
          response: string | null
          scores: Json | null
          search_results: Json | null
          sources: Json | null
          status: string
          summary: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          classification?: Json | null
          created_at?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          mode?: string
          model?: string | null
          project_id?: string | null
          purpose?: string | null
          query: string
          response?: string | null
          scores?: Json | null
          search_results?: Json | null
          sources?: Json | null
          status?: string
          summary?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          classification?: Json | null
          created_at?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          mode?: string
          model?: string | null
          project_id?: string | null
          purpose?: string | null
          query?: string
          response?: string | null
          scores?: Json | null
          search_results?: Json | null
          sources?: Json | null
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      document_artifacts: {
        Row: {
          created_at: string | null
          document_id: string
          id: string
          kind: string
          payload: Json
          updated_at: string | null
          version: number
        }
        Insert: {
          created_at?: string | null
          document_id: string
          id?: string
          kind: string
          payload: Json
          updated_at?: string | null
          version?: number
        }
        Update: {
          created_at?: string | null
          document_id?: string
          id?: string
          kind?: string
          payload?: Json
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_artifacts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
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
          context_card: Json | null
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
          summary_status: string
          supersedes: string | null
          title: string
          type: string
          updated_at: string | null
          version_number: number | null
          version_of: string | null
        }
        Insert: {
          classification?: string
          context_card?: Json | null
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
          summary_status?: string
          supersedes?: string | null
          title: string
          type?: string
          updated_at?: string | null
          version_number?: number | null
          version_of?: string | null
        }
        Update: {
          classification?: string
          context_card?: Json | null
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
          summary_status?: string
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
      entity_relationships: {
        Row: {
          confidence: string
          direction: string
          entity_a_id: string
          entity_b_id: string
          extracted_at: string
          id: string
          relation_type: string
          source_chunk_id: string | null
          source_document_id: string | null
        }
        Insert: {
          confidence?: string
          direction?: string
          entity_a_id: string
          entity_b_id: string
          extracted_at?: string
          id?: string
          relation_type: string
          source_chunk_id?: string | null
          source_document_id?: string | null
        }
        Update: {
          confidence?: string
          direction?: string
          entity_a_id?: string
          entity_b_id?: string
          extracted_at?: string
          id?: string
          relation_type?: string
          source_chunk_id?: string | null
          source_document_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_relationships_entity_a_id_fkey"
            columns: ["entity_a_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_entity_b_id_fkey"
            columns: ["entity_b_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_source_chunk_id_fkey"
            columns: ["source_chunk_id"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relationships_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      fact_versions: {
        Row: {
          claim_key: string
          claim_label: string
          document_date: string | null
          extracted_at: string
          id: string
          previous_value: string | null
          source_chunk_id: string | null
          source_document_id: string | null
          value: string
        }
        Insert: {
          claim_key: string
          claim_label: string
          document_date?: string | null
          extracted_at?: string
          id?: string
          previous_value?: string | null
          source_chunk_id?: string | null
          source_document_id?: string | null
          value: string
        }
        Update: {
          claim_key?: string
          claim_label?: string
          document_date?: string | null
          extracted_at?: string
          id?: string
          previous_value?: string | null
          source_chunk_id?: string | null
          source_document_id?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "fact_versions_source_chunk_id_fkey"
            columns: ["source_chunk_id"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fact_versions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
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
      graph_edges: {
        Row: {
          confidence: number | null
          created_at: string | null
          edge_type: string
          evidence: Json | null
          id: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          updated_at: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          edge_type: string
          evidence?: Json | null
          id?: string
          source_id: string
          source_type: string
          target_id: string
          target_type: string
          updated_at?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          edge_type?: string
          evidence?: Json | null
          id?: string
          source_id?: string
          source_type?: string
          target_id?: string
          target_type?: string
          updated_at?: string | null
        }
        Relationships: []
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
      memory_items: {
        Row: {
          created_at: string | null
          entities: string[] | null
          id: string
          importance: number | null
          kind: string
          scope_id: string | null
          scope_type: string
          source_conversation_id: string | null
          source_document_id: string | null
          text: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          entities?: string[] | null
          id?: string
          importance?: number | null
          kind: string
          scope_id?: string | null
          scope_type: string
          source_conversation_id?: string | null
          source_document_id?: string | null
          text: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          entities?: string[] | null
          id?: string
          importance?: number | null
          kind?: string
          scope_id?: string | null
          scope_type?: string
          source_conversation_id?: string | null
          source_document_id?: string | null
          text?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memory_items_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_items_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      message_feedback: {
        Row: {
          created_at: string
          id: string
          message_id: string
          note: string | null
          verdict: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          note?: string | null
          verdict: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          note?: string | null
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
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
      negotiation_documents: {
        Row: {
          added_at: string
          document_id: string
          negotiation_id: string
          role: string | null
        }
        Insert: {
          added_at?: string
          document_id: string
          negotiation_id: string
          role?: string | null
        }
        Update: {
          added_at?: string
          document_id?: string
          negotiation_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "negotiation_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiation_documents_negotiation_id_fkey"
            columns: ["negotiation_id"]
            isOneToOne: false
            referencedRelation: "negotiations"
            referencedColumns: ["id"]
          },
        ]
      }
      negotiations: {
        Row: {
          closed_at: string | null
          counterparty_entity_id: string | null
          created_at: string
          id: string
          key_terms: Json | null
          name: string
          opened_at: string
          project_id: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          counterparty_entity_id?: string | null
          created_at?: string
          id?: string
          key_terms?: Json | null
          name: string
          opened_at?: string
          project_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          counterparty_entity_id?: string | null
          created_at?: string
          id?: string
          key_terms?: Json | null
          name?: string
          opened_at?: string
          project_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "negotiations_counterparty_entity_id_fkey"
            columns: ["counterparty_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negotiations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      obligations: {
        Row: {
          action: string
          counterparty_entity_id: string | null
          created_at: string
          deadline: string | null
          id: string
          note: string | null
          project_id: string | null
          responsible_entity_id: string | null
          source_chunk_id: string | null
          source_document_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          action: string
          counterparty_entity_id?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          note?: string | null
          project_id?: string | null
          responsible_entity_id?: string | null
          source_chunk_id?: string | null
          source_document_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          action?: string
          counterparty_entity_id?: string | null
          created_at?: string
          deadline?: string | null
          id?: string
          note?: string | null
          project_id?: string | null
          responsible_entity_id?: string | null
          source_chunk_id?: string | null
          source_document_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "obligations_counterparty_entity_id_fkey"
            columns: ["counterparty_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_responsible_entity_id_fkey"
            columns: ["responsible_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_source_chunk_id_fkey"
            columns: ["source_chunk_id"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obligations_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      project_companies: {
        Row: {
          added_at: string
          entity_id: string
          project_id: string
          role: string
        }
        Insert: {
          added_at?: string
          entity_id: string
          project_id: string
          role?: string
        }
        Update: {
          added_at?: string
          entity_id?: string
          project_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_companies_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_companies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_documents: {
        Row: {
          added_at: string
          added_by: string | null
          confidence: number | null
          document_id: string
          is_primary: boolean | null
          link_type: string | null
          project_id: string
          relevance: number | null
          role: string | null
          why_linked: string | null
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          confidence?: number | null
          document_id: string
          is_primary?: boolean | null
          link_type?: string | null
          project_id: string
          relevance?: number | null
          role?: string | null
          why_linked?: string | null
        }
        Update: {
          added_at?: string
          added_by?: string | null
          confidence?: number | null
          document_id?: string
          is_primary?: boolean | null
          link_type?: string | null
          project_id?: string
          relevance?: number | null
          role?: string | null
          why_linked?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_entities: {
        Row: {
          added_at: string
          entity_id: string
          importance: number | null
          project_id: string
          role: string
          why_linked: string | null
        }
        Insert: {
          added_at?: string
          entity_id: string
          importance?: number | null
          project_id: string
          role?: string
          why_linked?: string | null
        }
        Update: {
          added_at?: string
          entity_id?: string
          importance?: number | null
          project_id?: string
          role?: string
          why_linked?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_entities_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_entities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          brief: Json | null
          closed_at: string | null
          color: string | null
          context_summary: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          kind: string
          name: string
          next_actions: Json | null
          objective: string | null
          slug: string
          stage: string
          start_date: string | null
          status: string
          target_close: string | null
          updated_at: string
        }
        Insert: {
          brief?: Json | null
          closed_at?: string | null
          color?: string | null
          context_summary?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          kind?: string
          name: string
          next_actions?: Json | null
          objective?: string | null
          slug: string
          stage?: string
          start_date?: string | null
          status?: string
          target_close?: string | null
          updated_at?: string
        }
        Update: {
          brief?: Json | null
          closed_at?: string | null
          color?: string | null
          context_summary?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          kind?: string
          name?: string
          next_actions?: Json | null
          objective?: string | null
          slug?: string
          stage?: string
          start_date?: string | null
          status?: string
          target_close?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      style_profiles: {
        Row: {
          created_at: string
          document_type: string
          id: string
          is_active: boolean
          language: string
          profile_json: Json
          source_document_ids: string[]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          document_type?: string
          id?: string
          is_active?: boolean
          language?: string
          profile_json: Json
          source_document_ids?: string[]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Update: {
          created_at?: string
          document_type?: string
          id?: string
          is_active?: boolean
          language?: string
          profile_json?: Json
          source_document_ids?: string[]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      workspace_profile: {
        Row: {
          briefing_cache: Json | null
          briefing_generated_at: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          organization: string
          organization_short: string | null
          phone: string | null
          preferred_language: string
          signature: string
          title: string
          updated_at: string
        }
        Insert: {
          briefing_cache?: Json | null
          briefing_generated_at?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          organization: string
          organization_short?: string | null
          phone?: string | null
          preferred_language?: string
          signature: string
          title: string
          updated_at?: string
        }
        Update: {
          briefing_cache?: Json | null
          briefing_generated_at?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          organization?: string
          organization_short?: string | null
          phone?: string | null
          preferred_language?: string
          signature?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hybrid_search: {
        Args: {
          excluded_doc_ids?: string[]
          filter_classification?: string
          filter_document_id?: string
          included_doc_ids?: string[]
          match_count?: number
          max_per_document?: number
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
      search_conversations: {
        Args: { match_count?: number; query_text: string }
        Returns: {
          conversation_id: string
          conversation_title: string
          last_message_at: string
          matched_message_id: string
          matched_message_role: string
          project_id: string
          rank: number
          snippet: string
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
